import {
  actionToAiMessage,
  applyHint,
  applyProbe,
  buildExchangeReview,
  mergeInsightResults,
  nextTurnAction,
  revealVerdict as createVerdict,
  scanWrongApproaches,
  scanAcceptableAlternatives,
  scanTutorIntent,
  synthesizeWrongApproachClassification,
  synthesizeAcceptableClassification,
  synthesizeIntentClassification,
  type ClassifyRequest,
  type TurnAction,
  type Verdict,
} from "@reason/core";
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
    const layer1Match = scanWrongApproaches(message, session.rubric);
    const altMatch = scanAcceptableAlternatives(message, session.rubric);
    const tutorIntent = scanTutorIntent(message);

    let classification;
    if (layer1Match) {
      classification = synthesizeWrongApproachClassification(
        session.rubric,
        layer1Match,
      );
      session.context.hadWrongApproach = true;
    } else if (altMatch) {
      classification = synthesizeAcceptableClassification(
        session.rubric,
        altMatch,
      );
      session.context.lastAcceptableAlternative = altMatch;
    } else if (tutorIntent) {
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
    }

    if (
      hadWrongBefore &&
      !layer1Match &&
      !classification.matchedWrongApproach &&
      classification.messageKind === "approach"
    ) {
      session.context.selfCorrections += 1;
    }

    session.context.insightResults = mergeInsightResults(
      session.context.insightResults,
      classification.insights,
    );

    let action = nextTurnAction(
      session.context,
      session.rubric,
      classification,
    );

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
