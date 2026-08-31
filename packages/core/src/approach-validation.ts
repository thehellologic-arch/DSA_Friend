import type {
  ApproachEvaluation,
  Rubric,
  ValidationOutcome,
} from "./rubric.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonicalize((value as Record<string, unknown>)[key]),
        ]),
    );
  }

  return value;
}

export function normalizedJson(value: unknown): string | undefined {
  return JSON.stringify(canonicalize(value));
}

export function evaluateEvidence(
  rubric: Rubric,
  evaluation: ApproachEvaluation,
): ValidationOutcome {
  const validation = rubric.validation;
  if (!validation) {
    return {
      status: "plausible_unverified",
      reason: "No deterministic validation configuration is available.",
    };
  }

  if (evaluation.approach.criticalGaps.length > 0) {
    return {
      status: "plausible_unverified",
      reason: `Critical gaps remain: ${evaluation.approach.criticalGaps.join("; ")}`,
    };
  }

  const expectedIds = new Set(validation.cases.map((testCase) => testCase.id));
  const predictionCounts = new Map<string, number>();
  for (const prediction of evaluation.casePredictions) {
    predictionCounts.set(
      prediction.caseId,
      (predictionCounts.get(prediction.caseId) ?? 0) + 1,
    );
  }

  const hasExactlyOnePredictionPerCase =
    expectedIds.size === validation.cases.length &&
    evaluation.casePredictions.length === validation.cases.length &&
    evaluation.casePredictions.every((prediction) =>
      expectedIds.has(prediction.caseId),
    ) &&
    validation.cases.every(
      (testCase) => predictionCounts.get(testCase.id) === 1,
    );

  if (!hasExactlyOnePredictionPerCase) {
    return {
      status: "plausible_unverified",
      reason:
        "Validation requires exactly one prediction for every supplied case and no extra predictions.",
    };
  }

  const predictions = new Map(
    evaluation.casePredictions.map((prediction) => [
      prediction.caseId,
      prediction.output,
    ]),
  );
  const evidence: string[] = [];

  for (const testCase of validation.cases) {
    const predicted = predictions.get(testCase.id);
    if (normalizedJson(predicted) !== normalizedJson(testCase.output)) {
      return {
        status: "incorrect",
        counterexample: `Case ${testCase.id}: input ${JSON.stringify(
          testCase.input,
        )}, predicted ${JSON.stringify(predicted)}, expected ${JSON.stringify(
          testCase.output,
        )}.`,
      };
    }

    evidence.push(testCase.id);
  }

  return { status: "acceptable", evidence };
}
