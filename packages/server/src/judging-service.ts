import {
  actionToAiMessage,
  applyHint,
  applyProbe,
  buildExchangeReview,
  computeScore,
  evaluateEvidence,
  mergeInsightResults,
  nextTurnAction,
  revealVerdict as createVerdict,
  scanWrongApproaches,
  scanAcceptableAlternatives,
  scanTutorIntent,
  synthesizeWrongApproachClassification,
  synthesizeAcceptableClassification,
  synthesizeIntentClassification,
  type ApproachEvaluation,
  type ApproachModel,
  type ClassifyRequest,
  type ClassifyResult,
  type Rubric,
  type TurnAction,
  type Verdict,
} from "@reason/core";
import {
  ApproachEvaluationUnavailableError,
  type ApproachEvaluationRequest,
} from "./approach-evaluator.js";
import type { LLMProvider } from "./ollama-provider.js";
import type { ProgressService, ProgressUpdate } from "./progress-service.js";
import {
  getTranscript,
  type InMemorySessionStore,
  type Session,
  updateSessionState,
} from "./session-store.js";

export interface TurnResponse {
  action: TurnAction;
  transcript: { role: "USER" | "AI"; content: string }[];
  hintsUsed: number;
  state: string;
  progress?: ProgressUpdate;
}

function actionMeta(action: TurnAction): {
  actionKind?: "follow_up" | "hint" | "counterexample";
  insightId?: string;
} {
  switch (action.kind) {
    case "follow_up":
      return { actionKind: "follow_up", insightId: action.insightId };
    case "hint":
      return { actionKind: "hint", insightId: action.insightId };
    case "counterexample":
      return { actionKind: "counterexample", insightId: action.insightId };
    default:
      return {};
  }
}

function normalizeComplexity(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function mapSupportedLabel(
  evaluation: ApproachEvaluation,
  rubric: Rubric,
): "optimal" | "acceptable" {
  const claimed = evaluation.approach.claimedComplexity?.time;
  if (claimed == null || claimed === "") return "acceptable";
  if (
    normalizeComplexity(claimed) ===
    normalizeComplexity(rubric.optimal.complexity.time)
  ) {
    return "optimal";
  }
  return "acceptable";
}

function classificationFromEvaluation(
  evaluation: ApproachEvaluation,
  rubric: Rubric,
): ClassifyResult {
  return {
    insights:
      evaluation.canonicalInsights.length > 0
        ? evaluation.canonicalInsights
        : rubric.required_insights.map((insight) => ({
            id: insight.id,
            status: "no" as const,
            evidence: null,
          })),
    matchedWrongApproach: null,
    matchedAcceptableAlternative: null,
    claimsOptimal: false,
    confidence: evaluation.confidence,
    messageKind: evaluation.messageKind,
  };
}

function buildLabeledVerdict(
  session: Session,
  label: Verdict["label"],
  suggestion: string,
): Verdict {
  const insights = session.rubric.required_insights.map((spec) => {
    const result = session.context.insightResults.find((r) => r.id === spec.id);
    return {
      id: spec.id,
      desc: spec.desc,
      status: result?.status ?? ("no" as const),
    };
  });

  return {
    label,
    score: computeScore(
      session.context.insightResults,
      session.context.hintsUsed,
      session.context.selfCorrections,
      session.rubric,
    ),
    insights,
    suggestion,
    idealSolution: {
      approach: session.rubric.optimal.approach,
      keyInsight: session.rubric.optimal.key_insight,
      complexity: session.rubric.optimal.complexity,
      examples: session.rubric.optimal.examples ?? [],
    },
    hintsUsed: session.context.hintsUsed,
    exchanges: buildExchangeReview(session.turns, session.rubric),
  };
}

function buildEvaluationRequest(
  session: Session,
  message: string,
  opts: {
    priorApproach: ApproachModel | null;
    challengeAnswer: string | null;
  },
): ApproachEvaluationRequest {
  const validation = session.rubric.validation!;
  return {
    coreAsk: session.rubric.core_ask,
    constraints: `${session.rubric.optimal.approach} Target complexity: ${session.rubric.optimal.complexity.time} time, ${session.rubric.optimal.complexity.space} space.`,
    cases: validation.cases.map(({ id, input }) => ({ id, input })),
    priorApproach: opts.priorApproach,
    challengeAnswer: opts.challengeAnswer,
    relevantQuotes: [message],
    latestUserMessage: message,
    history: getTranscript(session).slice(0, -1),
  };
}

export class JudgingService {
  constructor(
    private store: InMemorySessionStore,
    private llm: LLMProvider,
    private progress: ProgressService,
  ) {}

  async handleTurn(
    sessionId: string,
    message: string,
    idempotencyKey: string,
  ): Promise<TurnResponse> {
    const session = this.store.get(sessionId);
    if (!session) throw new Error("Session not found");

    const cached = session.idempotencyCache.get(idempotencyKey);
    if (cached) {
      return this.buildResponse(session, cached);
    }

    if (session.context.state === "VERDICT") {
      session.turns.push({
        idx: session.turns.length,
        role: "USER",
        content: message,
        idempotencyKey,
      });

      const text = await this.llm.clarify(
        {
          question: message,
          history: getTranscript(session).slice(0, -1),
        },
        session.rubric,
      );
      const action: TurnAction = { kind: "clarification", text };

      session.turns.push({
        idx: session.turns.length,
        role: "AI",
        content: text,
      });
      session.idempotencyCache.set(idempotencyKey, action);
      return this.buildResponse(session, action);
    }

    session.turns.push({
      idx: session.turns.length,
      role: "USER",
      content: message,
      idempotencyKey,
    });

    const hadWrongBefore = session.context.hadWrongApproach;
    const tutorIntent = scanTutorIntent(message);
    const layer1Match = scanWrongApproaches(message, session.rubric);
    const altMatch = scanAcceptableAlternatives(message, session.rubric);

    let classification: ClassifyResult;
    let action: TurnAction;

    if (tutorIntent) {
      classification = synthesizeIntentClassification(
        session.rubric,
        tutorIntent,
      );
      if (tutorIntent === "pushback") {
        classification = {
          ...classification,
          matchedAcceptableAlternative:
            session.context.lastAcceptableAlternative,
        };
      }
      action = this.applyClassification(session, classification, hadWrongBefore);
    } else if (layer1Match) {
      classification = synthesizeWrongApproachClassification(
        session.rubric,
        layer1Match,
      );
      session.context.hadWrongApproach = true;
      action = this.applyClassification(session, classification, hadWrongBefore);
    } else if (altMatch) {
      classification = synthesizeAcceptableClassification(
        session.rubric,
        altMatch,
      );
      session.context.lastAcceptableAlternative = altMatch;
      action = this.applyClassification(session, classification, hadWrongBefore);
    } else if (session.rubric.validation) {
      const isChallengeAnswer = session.context.pendingNovelChallenge != null;
      const priorApproach = isChallengeAnswer
        ? session.context.approachModel
        : null;
      const challengeAnswer = isChallengeAnswer ? message : null;

      if (isChallengeAnswer) {
        session.context.pendingNovelChallenge = null;
      }

      try {
        const { evaluation } = await this.llm.evaluateApproach(
          buildEvaluationRequest(session, message, {
            priorApproach,
            challengeAnswer,
          }),
        );
        session.context.approachModel = evaluation.approach;

        const handled = this.handleEvaluation(
          session,
          evaluation,
          hadWrongBefore,
        );
        classification = handled.classification;
        action = handled.action;
      } catch (err) {
        if (err instanceof ApproachEvaluationUnavailableError) {
          classification = synthesizeIntentClassification(
            session.rubric,
            "approach",
          );
          action = {
            kind: "verdict",
            verdict: buildLabeledVerdict(
              session,
              "plausible_unverified",
              "Approach evaluation was unavailable, so this attempt could not be verified.",
            ),
          };
        } else {
          throw err;
        }
      }
    } else {
      const classifyRequest: ClassifyRequest = {
        coreAsk: session.rubric.core_ask,
        requiredInsights: session.rubric.required_insights.map((i) => ({
          id: i.id,
          desc: i.desc,
        })),
        wrongApproaches: session.rubric.common_wrong_approaches.map((w) => ({
          id: w.id,
          whyWrong: w.why_wrong,
          signals: w.match_signals,
        })),
        history: getTranscript(session).slice(0, -1),
        latestUserMessage: message,
      };

      classification = await this.llm.classify(
        classifyRequest,
        session.rubric,
      );

      if (classification.matchedWrongApproach) {
        session.context.hadWrongApproach = true;
      }
      if (classification.matchedAcceptableAlternative) {
        session.context.lastAcceptableAlternative =
          classification.matchedAcceptableAlternative;
      }

      action = this.applyClassification(session, classification, hadWrongBefore);
    }

    if (action.kind === "follow_up" || action.kind === "counterexample") {
      if (action.kind === "follow_up") {
        session.context = applyProbe(session.context, action.insightId);
      }
    } else if (action.kind === "hint") {
      session.context = applyHint(session.context, action.insightId);
    }

    if (action.kind === "verdict") {
      const exchanges = buildExchangeReview(session.turns, session.rubric);
      action = {
        kind: "verdict",
        verdict: { ...action.verdict, exchanges },
      };
      updateSessionState(session, "VERDICT");
    } else if (action.kind === "verdict_ready") {
      updateSessionState(session, "AWAIT_VERDICT");
    } else {
      updateSessionState(session, "FOLLOW_UP");
    }

    const aiMessage = actionToAiMessage(action);
    const meta = actionMeta(action);
    session.turns.push({
      idx: session.turns.length,
      role: "AI",
      content: aiMessage,
      classifierOutput: classification,
      ...meta,
    });

    if (action.kind === "verdict") {
      await this.persistVerdict(session, action.verdict);
    }

    session.idempotencyCache.set(idempotencyKey, action);
    return this.buildResponse(session, action);
  }

  private handleEvaluation(
    session: Session,
    evaluation: ApproachEvaluation,
    hadWrongBefore: boolean,
  ): {
    classification: ClassifyResult;
    action: TurnAction;
  } {
    const messageKind = evaluation.messageKind;

    if (
      messageKind === "off_topic" ||
      messageKind === "sample_request" ||
      messageKind === "pushback" ||
      messageKind === "question"
    ) {
      const classification = classificationFromEvaluation(
        evaluation,
        session.rubric,
      );
      if (messageKind === "pushback") {
        classification.matchedAcceptableAlternative =
          session.context.lastAcceptableAlternative;
      }
      return {
        classification,
        action: this.applyClassification(
          session,
          classification,
          hadWrongBefore,
        ),
      };
    }

    if (evaluation.route === "known_canonical") {
      const classification = classificationFromEvaluation(
        evaluation,
        session.rubric,
      );
      return {
        classification,
        action: this.applyClassification(
          session,
          classification,
          hadWrongBefore,
        ),
      };
    }

    // novel / underspecified: evidence gates; do not merge canonical insights
    const classification = classificationFromEvaluation(
      {
        ...evaluation,
        canonicalInsights: [],
      },
      session.rubric,
    );

    if (
      hadWrongBefore &&
      !classification.matchedWrongApproach &&
      classification.messageKind === "approach"
    ) {
      session.context.selfCorrections += 1;
    }

    const outcome = evaluateEvidence(session.rubric, evaluation);

    if (outcome.status === "incorrect") {
      return {
        classification,
        action: {
          kind: "verdict",
          verdict: buildLabeledVerdict(
            session,
            "incorrect",
            outcome.counterexample,
          ),
        },
      };
    }

    if (outcome.status === "plausible_unverified") {
      const challengeText = evaluation.challenge?.trim() ?? "";
      if (!session.context.novelChallengeUsed && challengeText.length > 0) {
        session.context.novelChallengeUsed = true;
        session.context.pendingNovelChallenge = challengeText;
        session.context.approachModel = evaluation.approach;
        return {
          classification,
          action: { kind: "novel_challenge", text: challengeText },
        };
      }

      return {
        classification,
        action: {
          kind: "verdict",
          verdict: buildLabeledVerdict(
            session,
            "plausible_unverified",
            outcome.reason,
          ),
        },
      };
    }

    // gates passed (acceptable/optimal evidence)
    const label =
      outcome.status === "optimal"
        ? "optimal"
        : mapSupportedLabel(evaluation, session.rubric);
    return {
      classification,
      action: {
        kind: "verdict",
        verdict: buildLabeledVerdict(
          session,
          label,
          session.rubric.optimal.key_insight,
        ),
      },
    };
  }

  private applyClassification(
    session: Session,
    classification: ClassifyResult,
    hadWrongBefore: boolean,
  ): TurnAction {
    if (
      hadWrongBefore &&
      !classification.matchedWrongApproach &&
      classification.messageKind === "approach"
    ) {
      session.context.selfCorrections += 1;
    }

    session.context.insightResults = mergeInsightResults(
      session.context.insightResults,
      classification.insights,
    );

    return nextTurnAction(session.context, session.rubric, classification);
  }

  async revealVerdict(
    sessionId: string,
    idempotencyKey: string,
  ): Promise<TurnResponse> {
    const session = this.store.get(sessionId);
    if (!session) throw new Error("Session not found");

    const cached = session.idempotencyCache.get(idempotencyKey);
    if (cached) return this.buildResponse(session, cached);

    let action = createVerdict(session.context, session.rubric);
    if (action.kind !== "verdict") {
      throw new Error("Failed to create verdict");
    }

    action = {
      kind: "verdict",
      verdict: {
        ...action.verdict,
        exchanges: buildExchangeReview(session.turns, session.rubric),
      },
    };
    session.turns.push({
      idx: session.turns.length,
      role: "AI",
      content: actionToAiMessage(action),
    });
    updateSessionState(session, "VERDICT");
    await this.persistVerdict(session, action.verdict);
    session.idempotencyCache.set(idempotencyKey, action);
    return this.buildResponse(session, action);
  }

  private async persistVerdict(session: Session, verdict: Verdict) {
    session.progressUpdate = await this.progress.recordVerdict({
      userId: session.userId,
      sessionId: session.id,
      problemSlug: session.problemSlug,
      pattern: session.rubric.pattern,
      difficulty: session.rubric.difficulty,
      coreAsk: session.rubric.core_ask,
      selfCorrections: session.context.selfCorrections,
      transcript: getTranscript(session),
      verdict,
    });
  }

  private buildResponse(session: Session, action: TurnAction): TurnResponse {
    return {
      action,
      transcript: getTranscript(session),
      hintsUsed: session.context.hintsUsed,
      state: session.context.state,
      progress: action.kind === "verdict" ? session.progressUpdate : undefined,
    };
  }
}
