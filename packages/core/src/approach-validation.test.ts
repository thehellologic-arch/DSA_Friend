import { describe, expect, it } from "vitest";
import {
  evaluateEvidence,
  type ApproachEvaluation,
  type Rubric,
} from "./index.js";
import { normalizedJson } from "./approach-validation.js";

const validationCases = [
  {
    id: "duplicates",
    input: { numbers: [3, 3], target: 6 },
    output: true,
    tags: ["duplicate"],
  },
  {
    id: "no-solution",
    input: { numbers: [1, 2, 4], target: 8 },
    output: false,
    tags: ["negative-result"],
  },
  {
    id: "negative-numbers",
    input: { numbers: [-3, 4, 7], target: 1 },
    output: true,
    tags: ["negative-number"],
  },
];

const rubric = {
  validation: {
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

describe("evaluateEvidence", () => {
  it("matches reordered prediction objects to the same curated output", () => {
    const expected = {
      exists: true,
      details: { pair: [3, 3], target: 6 },
    };
    const firstPrediction = {
      details: { target: 6, pair: [3, 3] },
      exists: true,
    };
    const secondPrediction = {
      exists: true,
      details: { target: 6, pair: [3, 3] },
    };

    expect(normalizedJson(firstPrediction)).toBe(normalizedJson(expected));
    expect(normalizedJson(secondPrediction)).toBe(normalizedJson(expected));
  });

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
});
