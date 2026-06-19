import type { InsightResult, Rubric } from "./rubric.js";

export function computeScore(
  insights: InsightResult[],
  hintsUsed: number,
  selfCorrections: number,
  rubric: Rubric,
): number {
  const totalWeight = rubric.required_insights.reduce(
    (sum, i) => sum + i.weight,
    0,
  );

  let earnedWeight = 0;
  for (const spec of rubric.required_insights) {
    const result = insights.find((r) => r.id === spec.id);
    if (!result) continue;
    if (result.status === "yes") earnedWeight += spec.weight;
    else if (result.status === "partial") earnedWeight += spec.weight * 0.5;
  }

  const baseScore = totalWeight > 0 ? (earnedWeight / totalWeight) * 100 : 0;
  const hintPenalty =
    rubric.scoring.hint_penalty_per_reveal * 100 * hintsUsed;
  const correctionBonus =
    rubric.scoring.self_correction_bonus * 100 * selfCorrections;

  return Math.round(
    Math.min(100, Math.max(0, baseScore - hintPenalty + correctionBonus)),
  );
}

export function allInsightsResolved(insights: InsightResult[]): boolean {
  return insights.every((i) => i.status === "yes");
}

export function hasUnresolvedInsights(insights: InsightResult[]): boolean {
  return insights.some((i) => i.status !== "yes");
}
