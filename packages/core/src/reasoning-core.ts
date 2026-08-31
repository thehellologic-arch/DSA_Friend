import { computeScore, allInsightsResolved } from "./scoring.js";
import {
  MAX_HINTS_PER_SESSION,
  type ClassifyResult,
  type FollowUpExchange,
  type InsightResult,
  type Rubric,
  type SessionContext,
  type TurnAction,
  type Verdict,
} from "./rubric.js";

export interface AnnotatedTurn {
  role: "USER" | "AI";
  content: string;
  actionKind?: "follow_up" | "hint" | "counterexample";
  insightId?: string;
}

function findWrongApproach(rubric: Rubric, id: string) {
  return rubric.common_wrong_approaches.find((w) => w.id === id);
}

function findInsight(rubric: Rubric, id: string) {
  return rubric.required_insights.find((i) => i.id === id);
}

function getIdealAnswer(
  rubric: Rubric,
  insightId: string | undefined,
  kind: FollowUpExchange["kind"],
): string {
  if (insightId) {
    const wrong = findWrongApproach(rubric, insightId);
    if (wrong && kind === "counterexample") {
      return `${wrong.why_wrong} Better approach: ${rubric.optimal.approach}`;
    }

    const insight = findInsight(rubric, insightId);
    if (insight) {
      const reveal = insight.hints[insight.hints.length - 1];
      if (kind === "hint") return reveal;
      if (insight.on_fail_suggestion) return insight.on_fail_suggestion;
      return reveal ?? insight.desc;
    }
  }

  return rubric.optimal.approach;
}

export function buildExchangeReview(
  turns: AnnotatedTurn[],
  rubric: Rubric,
): FollowUpExchange[] {
  const exchanges: FollowUpExchange[] = [];

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.role !== "AI" || !turn.actionKind) continue;
    if (
      turn.actionKind !== "follow_up" &&
      turn.actionKind !== "counterexample" &&
      turn.actionKind !== "hint"
    ) {
      continue;
    }

    const next = turns[i + 1];
    if (!next || next.role !== "USER") continue;

    exchanges.push({
      kind: turn.actionKind,
      question: turn.content,
      userAnswer: next.content,
      idealAnswer: getIdealAnswer(rubric, turn.insightId, turn.actionKind),
      insightId: turn.insightId,
    });
  }

  return exchanges;
}

function buildVerdictInsights(
  rubric: Rubric,
  insights: InsightResult[],
): Verdict["insights"] {
  return rubric.required_insights.map((spec) => {
    const result = insights.find((r) => r.id === spec.id);
    return {
      id: spec.id,
      desc: spec.desc,
      status: result?.status ?? "no",
    };
  });
}

function buildSuggestion(
  rubric: Rubric,
  insights: InsightResult[],
  matchedWrong: string | null,
): string {
  if (matchedWrong) {
    const wrong = findWrongApproach(rubric, matchedWrong);
    if (wrong) return wrong.why_wrong;
  }

  const missed = rubric.required_insights.find((spec) => {
    const result = insights.find((r) => r.id === spec.id);
    return result?.status !== "yes";
  });

  if (missed?.on_fail_suggestion) return missed.on_fail_suggestion;
  if (missed) return `Practice: ${missed.desc.toLowerCase()}.`;
  return rubric.optimal.key_insight;
}

function determineVerdictLabel(
  insights: InsightResult[],
  matchedWrong: string | null,
  hintsExhausted: boolean,
): Verdict["label"] {
  if (allInsightsResolved(insights)) return "optimal";
  if (matchedWrong && hintsExhausted) return "buggy";
  const allPartialOrYes = insights.every(
    (i) => i.status === "yes" || i.status === "partial",
  );
  if (allPartialOrYes && !matchedWrong) return "acceptable";
  return "incomplete";
}

function buildVerdict(
  ctx: SessionContext,
  rubric: Rubric,
  matchedWrong: string | null,
  hintsExhausted: boolean,
  exchanges: FollowUpExchange[] = [],
): Verdict {
  const insights = ctx.insightResults;
  const label = determineVerdictLabel(insights, matchedWrong, hintsExhausted);

  return {
    label,
    score: computeScore(
      insights,
      ctx.hintsUsed,
      ctx.selfCorrections,
      rubric,
    ),
    insights: buildVerdictInsights(rubric, insights),
    suggestion: buildSuggestion(rubric, insights, matchedWrong),
    idealSolution: {
      approach: rubric.optimal.approach,
      keyInsight: rubric.optimal.key_insight,
      complexity: rubric.optimal.complexity,
      examples: rubric.optimal.examples ?? [],
    },
    hintsUsed: ctx.hintsUsed,
    exchanges,
  };
}

export function revealVerdict(
  ctx: SessionContext,
  rubric: Rubric,
): TurnAction {
  return {
    kind: "verdict",
    verdict: buildVerdict(ctx, rubric, null, false),
  };
}

function verdictReady(): TurnAction {
  return {
    kind: "verdict_ready",
    text: "Your reasoning is ready to evaluate. Would you like to see the verdict now, or keep reasoning?",
  };
}

function pickNextUnresolvedInsight(
  rubric: Rubric,
  insights: InsightResult[],
): (typeof rubric.required_insights)[number] | null {
  const unresolved = rubric.required_insights
    .filter((spec) => {
      const result = insights.find((r) => r.id === spec.id);
      return !result || result.status !== "yes";
    })
    .sort((a, b) => b.weight - a.weight);

  return unresolved[0] ?? null;
}

function sampleLine(rubric: Rubric): string | null {
  const example = rubric.optimal.examples?.[0];
  if (!example) return null;
  return `Sample: ${example.input}. Expected ${example.output}.`;
}

function withSample(rubric: Rubric, question: string): string {
  const sample = sampleLine(rubric);
  return sample ? `${sample}\n\n${question}` : question;
}

function findAcceptable(rubric: Rubric, id: string) {
  return rubric.acceptable_alternatives.find(
    (alt) => alt.id === id || alt.approach === id,
  );
}

function probeText(
  rubric: Rubric,
  insight: Rubric["required_insights"][number],
  probeIndex: number,
): string {
  const question =
    insight.hints.length === 1
      ? insight.hints[0]
      : (insight.hints[probeIndex] ?? insight.hints[insight.hints.length - 2]);
  return withSample(rubric, question);
}

function revealText(
  rubric: Rubric,
  insight: Rubric["required_insights"][number],
): string {
  return withSample(rubric, insight.hints[insight.hints.length - 1]);
}

function shouldGiveReveal(
  ctx: SessionContext,
  insightId: string,
  hintCount: number,
): boolean {
  const probesUsed = ctx.probesUsedByInsight[insightId] ?? 0;
  if (hintCount === 1) return probesUsed >= 1;
  return probesUsed >= hintCount - 1;
}

export function nextTurnAction(
  ctx: SessionContext,
  rubric: Rubric,
  classification: ClassifyResult,
): TurnAction {
  const matchedWrong = classification.matchedWrongApproach ?? null;
  const matchedAcceptable = classification.matchedAcceptableAlternative ?? null;
  const messageKind = classification.messageKind ?? "approach";

  if (allInsightsResolved(ctx.insightResults)) {
    return verdictReady();
  }

  if (messageKind === "sample_request") {
    const sample = sampleLine(rubric);
    return {
      kind: "clarification",
      text: sample
        ? `${sample}\n\nWalk through this input with the approach you already described.`
        : `This problem: ${rubric.core_ask} How would you approach it?`,
    };
  }

  if (messageKind === "pushback") {
    const alt = matchedAcceptable
      ? findAcceptable(rubric, matchedAcceptable)
      : null;
    const method = alt?.approach ?? "the approach you already described";
    return {
      kind: "clarification",
      text: withSample(
        rubric,
        `That last probe was about a different method. Stay with ${method.replace(/\.$/, "")}. Trace it on the sample.`,
      ),
    };
  }

  if (messageKind !== "approach" && !matchedWrong && !matchedAcceptable) {
    if (messageKind === "question") {
      return {
        kind: "clarification",
        text: withSample(
          rubric,
          `This problem: ${rubric.core_ask} How would you approach it?`,
        ),
      };
    }
    return {
      kind: "clarification",
      text: "I only grade this problem. Tell me your approach — off-topic messages do not count as hints.",
    };
  }

  if (matchedWrong) {
    const wrong = findWrongApproach(rubric, matchedWrong);
    if (wrong) {
      return {
        kind: "counterexample",
        insightId: matchedWrong,
        input: wrong.counterexample,
        text: `Walk me through ${wrong.counterexample}. ${wrong.why_wrong}`,
      };
    }
  }

  if (matchedAcceptable) {
    const alt = findAcceptable(rubric, matchedAcceptable);
    const altProbes = ctx.probesUsedByInsight[matchedAcceptable] ?? 0;
    if (alt && altProbes === 0) {
      return {
        kind: "follow_up",
        insightId: matchedAcceptable,
        text: withSample(
          rubric,
          `${alt.approach} ${alt.note} Walk through the sample with that method — which values do you pick, and what is the answer?`,
        ),
      };
    }
    if (alt) {
      return verdictReady();
    }
  }

  if (ctx.hintsUsed >= MAX_HINTS_PER_SESSION) {
    return verdictReady();
  }

  const nextInsight = pickNextUnresolvedInsight(
    rubric,
    ctx.insightResults,
  );

  if (!nextInsight) {
    return verdictReady();
  }

  const probesUsed = ctx.probesUsedByInsight[nextInsight.id] ?? 0;

  if (!shouldGiveReveal(ctx, nextInsight.id, nextInsight.hints.length)) {
    return {
      kind: "follow_up",
      insightId: nextInsight.id,
      text: probeText(rubric, nextInsight, probesUsed),
    };
  }

  return {
    kind: "hint",
    insightId: nextInsight.id,
    text: revealText(rubric, nextInsight),
  };
}

export function applyProbe(
  ctx: SessionContext,
  insightId: string,
): SessionContext {
  return {
    ...ctx,
    probesUsedByInsight: {
      ...ctx.probesUsedByInsight,
      [insightId]: (ctx.probesUsedByInsight[insightId] ?? 0) + 1,
    },
    state: "FOLLOW_UP",
  };
}

export function applyHint(
  ctx: SessionContext,
  insightId: string,
): SessionContext {
  return {
    ...ctx,
    hintsUsed: ctx.hintsUsed + 1,
    hintsUsedByInsight: {
      ...ctx.hintsUsedByInsight,
      [insightId]: (ctx.hintsUsedByInsight[insightId] ?? 0) + 1,
    },
    state: "FOLLOW_UP",
  };
}

export function actionToAiMessage(action: TurnAction): string {
  switch (action.kind) {
    case "follow_up":
      return action.text;
    case "hint":
      return action.text;
    case "counterexample":
      return action.text;
    case "verdict_ready":
      return action.text;
    case "clarification":
      return action.text;
    case "verdict": {
      const v = action.verdict;
      const labelText =
        v.label === "optimal"
          ? "Optimal reached"
          : v.label === "acceptable"
            ? "Acceptable approach"
            : v.label === "buggy"
              ? "Approach has a bug"
              : "Incomplete reasoning";
      return `${labelText}. Score: ${v.score}/100. ${v.suggestion}`;
    }
  }
}
