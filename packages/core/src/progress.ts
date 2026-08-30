export type SkillLevel = "beginner" | "intermediate" | "advanced" | "expert";

export type TopicStatus =
  | "not_started"
  | "practicing"
  | "recommended"
  | "mastered"
  | "needs_review";

export type LevelAvailability =
  | "mastered"
  | "recommended"
  | "available"
  | "above_rating";

export interface TopicProgress {
  pattern: string;
  rating: number;
  masteryPercent: number;
  problemsCompleted: number;
  recentPerformance: number[];
  hintUsage: number;
  lastPracticedAt: string | null;
  status: TopicStatus;
}

export const REVIEW_AFTER_DAYS = 14;
export const MASTERY_THRESHOLD = 80;

/** Inclusive ceilings for levels 1–5. */
export const LEVEL_CEILINGS = [999, 1199, 1399, 1599, Number.POSITIVE_INFINITY];

export const SKILL_LEVELS: SkillLevel[] = [
  "beginner",
  "intermediate",
  "advanced",
  "expert",
];

export function isSkillLevel(value: string): value is SkillLevel {
  return (SKILL_LEVELS as string[]).includes(value);
}

export function computeMasteryPercent(scores: number[]): number {
  if (scores.length === 0) return 0;
  const sum = scores.reduce((acc, score) => acc + score, 0);
  return Math.round(sum / scores.length);
}

export function ratingToLevel(rating: number): number {
  const index = LEVEL_CEILINGS.findIndex((ceiling) => rating <= ceiling);
  return index === -1 ? 5 : index + 1;
}

export function difficultyToLevel(difficulty: number): number {
  return ratingToLevel(difficulty);
}

export function deriveTopicStatus(input: {
  problemsCompleted: number;
  masteryPercent: number;
  lastPracticedAt: string | null;
  now: Date;
  isRecommendedTopic: boolean;
}): TopicStatus {
  if (input.problemsCompleted === 0) return "not_started";

  if (input.lastPracticedAt) {
    const elapsedMs =
      input.now.getTime() - new Date(input.lastPracticedAt).getTime();
    const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
    if (elapsedDays > REVIEW_AFTER_DAYS) return "needs_review";
  }

  if (input.masteryPercent >= MASTERY_THRESHOLD) return "mastered";
  if (input.isRecommendedTopic) return "recommended";
  return "practicing";
}

export function levelAvailability(input: {
  level: number;
  recommendedLevel: number;
  masteryPercent: number;
}): LevelAvailability {
  if (
    input.level < input.recommendedLevel &&
    input.masteryPercent >= MASTERY_THRESHOLD
  ) {
    return "mastered";
  }
  if (input.level === input.recommendedLevel) return "recommended";
  if (input.level > input.recommendedLevel) return "above_rating";
  return "available";
}

export function levelBandLabel(level: number): string {
  const labels = ["800–999", "1000–1199", "1200–1399", "1400–1599", "1600+"];
  return labels[level - 1] ?? "1600+";
}

export function availabilityLabel(availability: LevelAvailability): string {
  switch (availability) {
    case "mastered":
      return "Mastered";
    case "recommended":
      return "Recommended";
    case "available":
      return "Available";
    case "above_rating":
      return "Above your current rating";
  }
}
