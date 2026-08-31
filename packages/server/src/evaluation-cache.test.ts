import { describe, expect, it } from "vitest";
import type { ApproachEvaluation, ApproachModel } from "@reason/core";
import {
  EvaluationCache,
  buildEvaluationCacheKey,
} from "./evaluation-cache.js";

const baseApproach: ApproachModel = {
  steps: ["Scan with a hash set."],
  state: ["seen set"],
  invariant: null,
  claimedComplexity: { time: "O(n)", space: "O(n)" },
  assumptions: [],
  evidence: [{ claim: "hash set", quote: "I keep a set of seen values" }],
  criticalGaps: [],
};

const cases = [
  { id: "basic_match", input: { numbers: [2, 7], target: 9 } },
  { id: "no_match", input: { numbers: [1, 2], target: 8 } },
];

function baseKeyInput(
  overrides: Partial<Parameters<typeof buildEvaluationCacheKey>[0]> = {},
) {
  return {
    rubricVersion: 1,
    model: "google/gemini-3.6-flash",
    promptVersion: "1",
    approachModel: "i keep a set of seen values and check complements",
    cases,
    challengeAnswer: null as string | null,
    ...overrides,
  };
}

const validEvaluation: ApproachEvaluation = {
  messageKind: "approach",
  route: "novel",
  canonicalInsights: [],
  approach: baseApproach,
  casePredictions: [
    { caseId: "basic_match", output: true, reasoning: "2+7" },
    { caseId: "no_match", output: false, reasoning: "no pair" },
  ],
  recommendation: "supported",
  challenge: null,
  confidence: 0.9,
};

describe("buildEvaluationCacheKey", () => {
  it("returns the same key for identical normalized input", () => {
    const a = buildEvaluationCacheKey(baseKeyInput());
    const b = buildEvaluationCacheKey(
      baseKeyInput({
        approachModel: "  I Keep A Set Of Seen Values And Check Complements  ",
        cases: [
          { id: "no_match", input: { target: 8, numbers: [1, 2] } },
          { id: "basic_match", input: { target: 9, numbers: [2, 7] } },
        ],
      }),
    );
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when rubric, model, or prompt version changes", () => {
    const base = buildEvaluationCacheKey(baseKeyInput());
    expect(buildEvaluationCacheKey(baseKeyInput({ rubricVersion: 2 }))).not.toBe(
      base,
    );
    expect(
      buildEvaluationCacheKey(baseKeyInput({ model: "other-model" })),
    ).not.toBe(base);
    expect(
      buildEvaluationCacheKey(baseKeyInput({ promptVersion: "2" })),
    ).not.toBe(base);
  });

  it("does not collide challenge answers with first-pass evaluations", () => {
    const firstPass = buildEvaluationCacheKey(
      baseKeyInput({
        approachModel: baseApproach,
        challengeAnswer: null,
      }),
    );
    const challenge = buildEvaluationCacheKey(
      baseKeyInput({
        approachModel: baseApproach,
        challengeAnswer: "I insert after the complement check.",
      }),
    );
    expect(firstPass).not.toBe(challenge);
  });
});

describe("EvaluationCache", () => {
  it("stores and returns successfully parsed evaluations", () => {
    const cache = new EvaluationCache();
    const key = buildEvaluationCacheKey(baseKeyInput());
    cache.set(key, validEvaluation);
    expect(cache.get(key)).toEqual(validEvaluation);
  });

  it("never reuses invalid schema output", () => {
    const cache = new EvaluationCache();
    const key = buildEvaluationCacheKey(baseKeyInput());
    expect(() =>
      cache.set(key, {
        route: "novel",
        // missing required ApproachEvaluation fields
      } as ApproachEvaluation),
    ).toThrow();
    expect(cache.get(key)).toBeUndefined();
  });
});
