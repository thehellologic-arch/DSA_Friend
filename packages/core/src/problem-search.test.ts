import { describe, expect, it } from "vitest";
import { matchProblemQuery, searchProblems } from "./index.js";
import type { RecommendableProblem } from "./index.js";

function problem(
  partial: Partial<RecommendableProblem> &
    Pick<RecommendableProblem, "slug" | "coreAsk">,
): RecommendableProblem {
  return {
    pattern: "hashmap",
    difficulty: 800,
    ...partial,
  };
}

const twoSum = problem({
  slug: "two-sum",
  title: "Two Sum",
  coreAsk: "Given an array of integers, return indices of two numbers that add up to target.",
});

const wordSearch = problem({
  slug: "word-search",
  title: "Word Search",
  coreAsk: "Find if a word exists on a 2D board.",
});

describe("matchProblemQuery", () => {
  it("matches a title case-insensitively", () => {
    expect(matchProblemQuery(twoSum, "two sum")).toBe(true);
  });

  it("matches coreAsk (description)", () => {
    expect(matchProblemQuery(twoSum, "add up to target")).toBe(true);
  });

  it("matches slug tokens", () => {
    expect(matchProblemQuery(twoSum, "two-sum")).toBe(true);
  });

  it("requires every query token to match", () => {
    expect(matchProblemQuery(twoSum, "two xyz")).toBe(false);
  });

  it("does not match unrelated text", () => {
    expect(matchProblemQuery(twoSum, "binary tree")).toBe(false);
  });

  it("treats empty or whitespace query as not a match", () => {
    expect(matchProblemQuery(twoSum, "")).toBe(false);
    expect(matchProblemQuery(twoSum, "   ")).toBe(false);
  });
});

describe("searchProblems", () => {
  it("returns matching problems in catalog order", () => {
    expect(searchProblems([twoSum, wordSearch], "word")).toEqual([wordSearch]);
  });

  it("returns an empty list for a blank query", () => {
    expect(searchProblems([twoSum, wordSearch], "  ")).toEqual([]);
  });
});
