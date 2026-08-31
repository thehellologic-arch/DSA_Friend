import { REVIEW_AFTER_DAYS, type TopicProgress } from "./progress.js";

export interface RecommendableProblem {
  slug: string;
  pattern: string;
  difficulty: number;
  coreAsk: string;
  title?: string;
  topic?: string;
}

export interface RecommendContext {
  topics: TopicProgress[];
  recentAttempts: { problemSlug: string; pattern: string; score: number }[];
  preferredPattern?: string;
  preferredDifficulty?: number;
  excludeSlug?: string;
  now: Date;
}

export function recommendProblems(
  problems: RecommendableProblem[],
  ctx: RecommendContext,
  limit: number,
): RecommendableProblem[] {
  const candidates = ctx.excludeSlug
    ? problems.filter((problem) => problem.slug !== ctx.excludeSlug)
    : problems;

  const scored = candidates.map((problem) => ({
    problem,
    score: scoreProblem(problem, ctx),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((item) => item.problem);
}

function scoreProblem(
  problem: RecommendableProblem,
  ctx: RecommendContext,
): number {
  const topic = ctx.topics.find((item) => item.pattern === problem.pattern);
  const rating = topic?.rating ?? 1100;
  const proximity = 100 - Math.min(100, Math.abs(problem.difficulty - rating) / 4);
  let score = proximity;
  if (topic?.status === "needs_review") score += 25;
  const last = ctx.recentAttempts.find(
    (attempt) => attempt.pattern === problem.pattern,
  );
  if (last && last.score < 50) score += 15;
  if (ctx.preferredPattern && problem.pattern === ctx.preferredPattern) {
    score += 40;
  }
  if (ctx.preferredDifficulty != null) {
    score += problem.difficulty === ctx.preferredDifficulty ? 80 : -20;
  }
  if (topic?.lastPracticedAt) {
    const days =
      (ctx.now.getTime() - new Date(topic.lastPracticedAt).getTime()) /
      (1000 * 60 * 60 * 24);
    if (days > REVIEW_AFTER_DAYS) score += 20;
  }
  return score;
}
