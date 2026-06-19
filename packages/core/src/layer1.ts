import type { ClassifyResult, Rubric } from "./rubric.js";

export function scanWrongApproaches(
  message: string,
  rubric: Rubric,
): string | null {
  const normalized = message.toLowerCase();

  for (const wrong of rubric.common_wrong_approaches) {
    for (const signal of wrong.match_signals) {
      if (normalized.includes(signal.toLowerCase())) {
        return wrong.id;
      }
    }
  }

  return null;
}

export function synthesizeWrongApproachClassification(
  rubric: Rubric,
  wrongApproachId: string,
): ClassifyResult {
  return {
    insights: rubric.required_insights.map((insight) => ({
      id: insight.id,
      status: "no" as const,
      evidence: null,
    })),
    matchedWrongApproach: wrongApproachId,
    claimsOptimal: false,
    confidence: 1,
  };
}
