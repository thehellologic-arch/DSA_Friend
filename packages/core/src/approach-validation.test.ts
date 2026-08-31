import { describe, expect, it } from "vitest";
import {
  evaluateEvidence,
  runOracle,
  type ApproachEvaluation,
  type Rubric,
} from "./index.js";

const validationCases = [
  {
    id: "duplicates",
    input: { numbers: [3, 3], target: 6 },
    tags: ["duplicate"],
  },
  {
    id: "no-solution",
    input: { numbers: [1, 2, 4], target: 8 },
    tags: ["negative-result"],
  },
  {
    id: "negative-numbers",
    input: { numbers: [-3, 4, 7], target: 1 },
    tags: ["negative-number"],
  },
];

const rubric = {
  validation: {
    oracle: "two_sum_exists",
    cases: validationCases,
  },
} as Rubric;

function makeEvaluation(
  overrides: Partial<ApproachEvaluation> = {},
): ApproachEvaluation {
  return {
    messageKind: "approach",
    route: "novel",
    canonicalInsights: [],
    approach: {
      steps: ["Track previously seen values."],
      state: ["A set of seen values."],
      invariant: null,
      claimedComplexity: null,
      assumptions: [],
      evidence: [],
      criticalGaps: [],
    },
    casePredictions: [
      { caseId: "duplicates", output: true, reasoning: "3 + 3 = 6" },
      { caseId: "no-solution", output: false, reasoning: "No pair sums to 8" },
      { caseId: "negative-numbers", output: true, reasoning: "-3 + 4 = 1" },
    ],
    recommendation: "supported",
    challenge: null,
    confidence: 0.9,
    ...overrides,
  };
}

describe("runOracle", () => {
  it("handles a Two Sum duplicate pair", () => {
    expect(
      runOracle("two_sum_exists", { numbers: [3, 3], target: 6 }),
    ).toBe(true);
  });

  it("returns false when no Two Sum solution exists", () => {
    expect(
      runOracle("two_sum_exists", { numbers: [1, 2, 4], target: 8 }),
    ).toBe(false);
  });

  it("handles negative numbers in Two Sum inputs", () => {
    expect(
      runOracle("two_sum_exists", { numbers: [-3, 4, 7], target: 1 }),
    ).toBe(true);
  });

  it("rejects unknown oracle IDs", () => {
    expect(() => runOracle("unknown", {})).toThrow(
      "Unknown validation oracle: unknown",
    );
  });
});

describe("evaluateEvidence", () => {
  it("accepts matching predictions and returns matched case IDs", () => {
    expect(evaluateEvidence(rubric, makeEvaluation())).toEqual({
      status: "acceptable",
      evidence: ["duplicates", "no-solution", "negative-numbers"],
    });
  });

  it("returns the first mismatching case as a counterexample", () => {
    const evaluation = makeEvaluation({
      casePredictions: [
        { caseId: "duplicates", output: false, reasoning: "Incorrect claim" },
        { caseId: "no-solution", output: true, reasoning: "Incorrect claim" },
        {
          caseId: "negative-numbers",
          output: true,
          reasoning: "Correct claim",
        },
      ],
    });

    const outcome = evaluateEvidence(rubric, evaluation);

    expect(outcome.status).toBe("incorrect");
    if (outcome.status === "incorrect") {
      expect(outcome.counterexample).toContain("duplicates");
    }
  });

  it("returns unverified when validation config is missing", () => {
    expect(evaluateEvidence({ ...rubric, validation: undefined }, makeEvaluation()))
      .toMatchObject({ status: "plausible_unverified" });
  });

  it("returns unverified when critical gaps are present", () => {
    const evaluation = makeEvaluation({
      approach: {
        ...makeEvaluation().approach,
        criticalGaps: ["Does not explain duplicate handling."],
      },
    });

    expect(evaluateEvidence(rubric, evaluation)).toMatchObject({
      status: "plausible_unverified",
    });
  });

  it.each([
    {
      name: "missing",
      predictions: makeEvaluation().casePredictions.slice(0, 2),
    },
    {
      name: "duplicate",
      predictions: [
        ...makeEvaluation().casePredictions,
        makeEvaluation().casePredictions[0]!,
      ],
    },
    {
      name: "extra",
      predictions: [
        ...makeEvaluation().casePredictions,
        { caseId: "unknown", output: true, reasoning: "Extra prediction" },
      ],
    },
  ])("returns unverified for $name case predictions", ({ predictions }) => {
    expect(
      evaluateEvidence(rubric, makeEvaluation({ casePredictions: predictions })),
    ).toMatchObject({ status: "plausible_unverified" });
  });

  it("does not let evaluator confidence override a failed gate", () => {
    const evaluation = makeEvaluation({
      approach: {
        ...makeEvaluation().approach,
        criticalGaps: ["Unresolved correctness gap."],
      },
      confidence: 1,
    });

    expect(evaluateEvidence(rubric, evaluation)).toMatchObject({
      status: "plausible_unverified",
    });
  });

  it("treats an unknown configured oracle as unverified", () => {
    const unknownOracleRubric = {
      ...rubric,
      validation: { ...rubric.validation!, oracle: "unknown" },
    };

    expect(evaluateEvidence(unknownOracleRubric, makeEvaluation())).toMatchObject({
      status: "plausible_unverified",
    });
  });
});
