import type { SkillLevel } from "./progress.js";

export const STARTING_RATING: Record<SkillLevel, number> = {
  beginner: 800,
  intermediate: 1100,
  advanced: 1400,
  expert: 1700,
};

export const DEFAULT_K = 32;
export const MIN_RATING = 400;

export function expectedScore(rating: number, difficulty: number): number {
  return 1 / (1 + 10 ** ((difficulty - rating) / 400));
}

export function ratingDelta(input: {
  rating: number;
  difficulty: number;
  score: number;
  hintsUsed: number;
  k?: number;
}): number {
  const actual = Math.min(1, Math.max(0, input.score / 100));
  const expected = expectedScore(input.rating, input.difficulty);
  const hintFactor = Math.max(0.5, 1 - 0.1 * input.hintsUsed);
  const k = input.k ?? DEFAULT_K;
  return Math.round(k * (actual - expected) * hintFactor);
}

export function applyRatingUpdate(input: {
  rating: number;
  difficulty: number;
  score: number;
  hintsUsed: number;
  k?: number;
}): { ratingBefore: number; ratingAfter: number; delta: number } {
  const delta = ratingDelta(input);
  const ratingAfter = Math.max(MIN_RATING, input.rating + delta);
  return {
    ratingBefore: input.rating,
    ratingAfter,
    delta: ratingAfter - input.rating,
  };
}
