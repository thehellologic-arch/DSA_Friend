import type { RecommendableProblem } from "./recommend.js";

function searchableText(problem: RecommendableProblem): string {
  return [problem.title ?? "", problem.coreAsk, problem.slug]
    .join(" ")
    .toLowerCase();
}

export function matchProblemQuery(
  problem: RecommendableProblem,
  query: string,
): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const text = searchableText(problem);
  return tokens.every((token) => text.includes(token));
}

export function searchProblems(
  problems: RecommendableProblem[],
  query: string,
): RecommendableProblem[] {
  return problems.filter((problem) => matchProblemQuery(problem, query));
}
