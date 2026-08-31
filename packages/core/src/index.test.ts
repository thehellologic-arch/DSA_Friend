import { describe, it, expect } from "vitest";
import {
  computeScore,
  initInsightResults,
  mergeInsightResults,
  nextTurnAction,
  parseRubric,
  ratingToLevel,
  scanWrongApproaches,
  scanAcceptableAlternatives,
  scanTutorIntent,
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
    examples: [
      {
        input: "[[1,2],[2,3],[3,4],[1,3]]",
        output: "3",
        explanation: "After sorting by end time, select [1,2], [2,3], and [3,4].",
      },
    ],
  },
  acceptable_alternatives: [
    {
      id: "weighted_dp",
      approach: "Weighted interval scheduling DP",
      note: "Correct but overkill; a simpler greedy exists.",
      match_signals: ["weighted interval", "dp on intervals"],
    },
  ],
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
    lastAcceptableAlternative: null,
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
    matchedAcceptableAlternative: null,
    claimsOptimal: false,
    confidence: 0.9,
    messageKind: "approach",
    ...partial,
  };
}

describe("rubric examples", () => {
  it("requires at least one example", () => {
    const { examples: _examples, ...optimalWithoutExamples } = rubric.optimal;

    expect(() =>
      parseRubric({
        ...rubric,
        optimal: optimalWithoutExamples,
      }),
    ).toThrow();
  });

  it("requires non-empty example fields", () => {
    expect(() =>
      parseRubric({
        ...rubric,
        optimal: {
          ...rubric.optimal,
          examples: [
            {
              input: "",
              output: "3",
              explanation: "Select three meetings.",
            },
          ],
        },
      }),
    ).toThrow();
  });
});

describe("layer1 keyword gate", () => {
  it("detects sort by start wrong approach", () => {
    expect(
      scanWrongApproaches("Sort by start time and pick greedily", rubric),
    ).toBe("sort_by_start");
  });

  it("returns null for neutral message", () => {
    expect(scanWrongApproaches("I would use a heap", rubric)).toBeNull();
  });

  it("detects an acceptable alternative", () => {
    expect(
      scanAcceptableAlternatives("I'd use weighted interval scheduling DP", rubric),
    ).toBe("weighted_dp");
  });

  it("treats a sample ask as sample_request, not a problem restatement", () => {
    expect(scanTutorIntent("can you provide the current number")).toBe(
      "sample_request",
    );
  });

  it("treats a complaint that the hint was unrelated as pushback", () => {
    expect(scanTutorIntent("this is completely non related")).toBe("pushback");
  });

  it("does not treat an approach that mentions the array as a sample request", () => {
    expect(
      scanTutorIntent("sort the array and then use two pointers"),
    ).toBeNull();
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
      expect(action.text).toContain("[[1,2],[2,3],[3,4],[1,3]]");
      expect(action.text).toContain("3");
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

  it("marks the verdict ready when all insights are resolved", () => {
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
    expect(action.kind).toBe("verdict_ready");
  });

  it("marks the verdict ready when hint budget is exhausted", () => {
    const action = nextTurnAction(
      makeCtx({ hintsUsed: 3 }),
      rubric,
      classify({ insights: initInsightResults(rubric) }),
    );
    expect(action.kind).toBe("verdict_ready");
  });

  it("does not burn a probe on off-topic messages", () => {
    const action = nextTurnAction(
      makeCtx(),
      rubric,
      classify({
        insights: initInsightResults(rubric),
        messageKind: "off_topic",
      }),
    );
    expect(action.kind).toBe("clarification");
    if (action.kind === "clarification") {
      expect(action.text).toContain("this problem");
    }
  });

  it("restates the problem when the user asks what it is", () => {
    const action = nextTurnAction(
      makeCtx(),
      rubric,
      classify({
        insights: initInsightResults(rubric),
        messageKind: "question",
      }),
    );
    expect(action.kind).toBe("clarification");
    if (action.kind === "clarification") {
      expect(action.text).toContain(rubric.core_ask);
    }
  });

  it("grounds an acceptable alternative in a sample instead of the optimal probe", () => {
    const action = nextTurnAction(
      makeCtx(),
      rubric,
      classify({
        insights: initInsightResults(rubric),
        matchedAcceptableAlternative: "weighted_dp",
      }),
    );
    expect(action.kind).toBe("follow_up");
    if (action.kind === "follow_up") {
      expect(action.text).toContain("[[1,2],[2,3],[3,4],[1,3]]");
      expect(action.text).toMatch(/Weighted interval scheduling DP/i);
      expect(action.text).not.toContain("What ordering helps most?");
    }
  });

  it("returns a sample when the user asks for the current numbers", () => {
    const action = nextTurnAction(
      makeCtx(),
      rubric,
      classify({
        insights: initInsightResults(rubric),
        messageKind: "sample_request",
      }),
    );
    expect(action.kind).toBe("clarification");
    if (action.kind === "clarification") {
      expect(action.text).toContain("[[1,2],[2,3],[3,4],[1,3]]");
      expect(action.text).toContain("Expected 3");
    }
  });

  it("re-grounds on pushback instead of treating it as off-topic", () => {
    const action = nextTurnAction(
      makeCtx(),
      rubric,
      classify({
        insights: initInsightResults(rubric),
        messageKind: "pushback",
        matchedAcceptableAlternative: "weighted_dp",
      }),
    );
    expect(action.kind).toBe("clarification");
    if (action.kind === "clarification") {
      expect(action.text).toContain("[[1,2],[2,3],[3,4],[1,3]]");
      expect(action.text).toMatch(/Weighted interval scheduling DP/i);
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

const twoSum: Rubric = {
  problem_id: "two-sum-hash-set",
  rubric_version: 1,
  pattern: "hashing",
  difficulty: 900,
  core_ask:
    "Given a list of numbers and a target, determine whether any two different elements add up to the target.",
  optimal: {
    approach: "Hash set of seen values; look up the complement.",
    complexity: { time: "O(n)", space: "O(n)" },
    key_insight: "Complement lookup in a set is O(1).",
    examples: [
      {
        input: "numbers = [2,7,11,15], target = 9",
        output: "true",
        explanation: "When scanning 7, its complement 2 is already in the set.",
      },
    ],
  },
  acceptable_alternatives: [
    {
      id: "two_pointers",
      approach: "Sort the values and use two pointers.",
      note: "Correct in O(n log n) time, but hashing is faster on average.",
      match_signals: ["two pointer", "two pointers", "left and right"],
    },
  ],
  common_wrong_approaches: [
    {
      id: "brute_force_pairs",
      match_signals: ["nested loops", "check every pair"],
      why_wrong: "Checking every pair takes O(n²) time.",
      counterexample: "A list with 100,000 values",
    },
  ],
  required_insights: [
    {
      id: "complement",
      desc: "Computes target minus the current value",
      weight: 3,
      hints: [
        "For the current number, what exact partner would complete the target?",
        "If the current value is x, what must already have been seen?",
        "Compute target - current value.",
      ],
    },
    {
      id: "hash_lookup",
      desc: "Uses a hash set for constant-time complement lookup",
      weight: 3,
      hints: [
        "How can you quickly know whether that partner appeared earlier?",
        "Store seen values in a hash set.",
      ],
    },
  ],
  edge_cases: [],
  scoring: {
    formula: "sum(weight of insights hit) / sum(all weights)",
    hint_penalty_per_reveal: 0.1,
    self_correction_bonus: 0.05,
  },
};

describe("two-sum acceptable alternative", () => {
  it("matches sort + two pointers without calling it a wrong approach", () => {
    const message = "sort the arry and use two pointers";
    expect(scanWrongApproaches(message, twoSum)).toBeNull();
    expect(scanAcceptableAlternatives(message, twoSum)).toBe("two_pointers");
  });

  it("asks about two pointers on a sample, not the hash-set complement", () => {
    const action = nextTurnAction(
      {
        state: "FOLLOW_UP",
        insightResults: initInsightResults(twoSum),
        hintsUsed: 0,
        hintsUsedByInsight: {},
        probesUsedByInsight: {},
        selfCorrections: 0,
        hadWrongApproach: false,
        lastAcceptableAlternative: null,
      },
      twoSum,
      classify({
        insights: initInsightResults(twoSum),
        matchedAcceptableAlternative: "two_pointers",
      }),
    );
    expect(action.kind).toBe("follow_up");
    if (action.kind === "follow_up") {
      expect(action.text).toContain("numbers = [2,7,11,15], target = 9");
      expect(action.text).toMatch(/two pointers/i);
      expect(action.text).not.toContain("what exact partner");
      expect(action.text).not.toContain("already have been seen");
    }
  });
});

describe("ratingToLevel", () => {
  it("maps Elo bands onto roadmap levels 1–5", () => {
    expect(ratingToLevel(800)).toBe(1);
    expect(ratingToLevel(999)).toBe(1);
    expect(ratingToLevel(1100)).toBe(2);
    expect(ratingToLevel(1250)).toBe(3);
    expect(ratingToLevel(1450)).toBe(4);
    expect(ratingToLevel(1800)).toBe(5);
  });
});
