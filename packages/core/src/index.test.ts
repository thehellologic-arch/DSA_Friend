import { describe, it, expect } from "vitest";
import {
  computeScore,
  initInsightResults,
  mergeInsightResults,
  nextTurnAction,
  scanWrongApproaches,
  type ClassifyResult,
  type Rubric,
  type SessionContext,
} from "./index.js";

const rubric: Rubric = {
  problem_id: "meeting-rooms-greedy",
  rubric_version: 3,
  pattern: "greedy",
  difficulty: 1200,
  core_ask:
    "Given meetings with start/end times, find the max you can attend without overlap.",
  optimal: {
    approach:
      "Sort by end time; greedily pick earliest-ending non-overlapping.",
    complexity: { time: "O(n log n)", space: "O(1)" },
    key_insight: "Earliest end time leaves the most room for future meetings.",
  },
  acceptable_alternatives: [],
  common_wrong_approaches: [
    {
      id: "sort_by_start",
      match_signals: ["sort by start", "earliest start", "begin time"],
      why_wrong: "One long early meeting blocks many short ones.",
      counterexample: "[[1,10],[2,3],[4,5]]",
    },
    {
      id: "sort_by_duration",
      match_signals: ["shortest", "by duration", "by length"],
      why_wrong: "Shortest-first ignores position.",
      counterexample: "[[1,5],[4,6],[6,7]]",
    },
  ],
  required_insights: [
    {
      id: "needs_sorting",
      desc: "Recognizes sorting is needed",
      weight: 1,
      hints: ["hint1", "hint2", "hint3"],
    },
    {
      id: "sort_by_end",
      desc: "Sorts by END time specifically",
      weight: 3,
      hints: ["hint1", "hint2", "hint3"],
      on_fail_suggestion: "Re-derive with end-time.",
    },
    {
      id: "greedy_justification",
      desc: "Justifies why greedy is optimal",
      weight: 2,
      hints: ["hint1", "hint2"],
    },
    {
      id: "complexity",
      desc: "States O(n log n)",
      weight: 1,
      hints: ["hint1", "hint2"],
    },
  ],
  edge_cases: [],
  scoring: {
    formula: "sum(weight of insights hit) / sum(all weights)",
    hint_penalty_per_reveal: 0.1,
    self_correction_bonus: 0.05,
  },
};

function makeCtx(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    state: "FOLLOW_UP",
    insightResults: initInsightResults(rubric),
    hintsUsed: 0,
    hintsUsedByInsight: {},
    probesUsedByInsight: {},
    selfCorrections: 0,
    hadWrongApproach: false,
    ...overrides,
  };
}

function classify(
  partial: Partial<ClassifyResult> & {
    insights: ClassifyResult["insights"];
  },
): ClassifyResult {
  return {
    matchedWrongApproach: null,
    claimsOptimal: false,
    confidence: 0.9,
    ...partial,
  };
}

describe("layer1 keyword gate", () => {
  it("detects sort by start wrong approach", () => {
    expect(
      scanWrongApproaches("Sort by start time and pick greedily", rubric),
    ).toBe("sort_by_start");
  });

  it("returns null for neutral message", () => {
    expect(scanWrongApproaches("I would use a heap", rubric)).toBeNull();
  });
});

describe("mergeInsightResults", () => {
  it("upgrades status but never downgrades", () => {
    const current = initInsightResults(rubric);
    current[0] = { id: "needs_sorting", status: "partial", evidence: "sort" };

    const merged = mergeInsightResults(
      current,
      [{ id: "needs_sorting", status: "no", evidence: null }],
    );
    expect(merged[0].status).toBe("partial");

    const upgraded = mergeInsightResults(
      current,
      [{ id: "needs_sorting", status: "yes", evidence: "sort first" }],
    );
    expect(upgraded[0].status).toBe("yes");
  });
});

describe("computeScore", () => {
  it("scores all-yes insights at 100 before penalties", () => {
    const insights = rubric.required_insights.map((i) => ({
      id: i.id,
      status: "yes" as const,
      evidence: "ok",
    }));
    expect(computeScore(insights, 0, 0, rubric)).toBe(100);
  });

  it("applies hint penalty and self-correction bonus", () => {
    const insights = rubric.required_insights.map((i) => ({
      id: i.id,
      status: "yes" as const,
      evidence: "ok",
    }));
    expect(computeScore(insights, 1, 1, rubric)).toBe(95);
  });
});

describe("nextTurnAction", () => {
  it("returns counterexample for wrong approach match", () => {
    const action = nextTurnAction(
      makeCtx(),
      rubric,
      classify({
        matchedWrongApproach: "sort_by_start",
        insights: initInsightResults(rubric).map((i) => ({
          ...i,
          status: "no",
        })),
      }),
    );
    expect(action.kind).toBe("counterexample");
    if (action.kind === "counterexample") {
      expect(action.insightId).toBe("sort_by_start");
      expect(action.text).toContain("[[1,10],[2,3],[4,5]]");
    }
  });

  it("returns follow_up (not hint) for partial approach", () => {
    const insights = initInsightResults(rubric);
    insights[0] = { id: "needs_sorting", status: "yes", evidence: "sort" };

    const action = nextTurnAction(
      makeCtx({ insightResults: insights }),
      rubric,
      classify({ insights }),
    );
    expect(action.kind).toBe("follow_up");
    if (action.kind === "follow_up") {
      expect(action.insightId).toBe("sort_by_end");
    }
  });

  it("returns hint only after probes exhausted", () => {
    const insights = initInsightResults(rubric);
    insights[0] = { id: "needs_sorting", status: "yes", evidence: "sort" };

    const action = nextTurnAction(
      makeCtx({
        insightResults: insights,
        probesUsedByInsight: { sort_by_end: 2 },
      }),
      rubric,
      classify({ insights }),
    );
    expect(action.kind).toBe("hint");
    if (action.kind === "hint") {
      expect(action.insightId).toBe("sort_by_end");
    }
  });

  it("returns optimal verdict when all insights yes", () => {
    const insights = rubric.required_insights.map((i) => ({
      id: i.id,
      status: "yes" as const,
      evidence: "ok",
    }));

    const action = nextTurnAction(
      makeCtx({ insightResults: insights }),
      rubric,
      classify({ insights }),
    );
    expect(action.kind).toBe("verdict");
    if (action.kind === "verdict") {
      expect(action.verdict.label).toBe("optimal");
      expect(action.verdict.score).toBe(100);
    }
  });

  it("returns verdict when hint budget exhausted", () => {
    const action = nextTurnAction(
      makeCtx({ hintsUsed: 3 }),
      rubric,
      classify({ insights: initInsightResults(rubric) }),
    );
    expect(action.kind).toBe("verdict");
    if (action.kind === "verdict") {
      expect(action.verdict.label).toBe("incomplete");
    }
  });
});

describe("golden test strings (classification inputs)", () => {
  it("bad approach triggers layer1 without LLM", () => {
    const bad = "Sort by start time and pick greedily";
    expect(scanWrongApproaches(bad, rubric)).toBe("sort_by_start");
  });

  it("partial approach would leave sort_by_end unresolved", () => {
    const partialInsights = initInsightResults(rubric);
    partialInsights[0] = {
      id: "needs_sorting",
      status: "yes",
      evidence: "I'd sort",
    };

    const action = nextTurnAction(
      makeCtx({ insightResults: partialInsights }),
      rubric,
      classify({
        insights: partialInsights,
      }),
    );
    expect(action.kind).toBe("follow_up");
  });
});
