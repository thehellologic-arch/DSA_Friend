import { describe, expect, it } from "vitest";
import { resolveNovelEvaluationMode } from "./evaluation-metrics.js";

describe("resolveNovelEvaluationMode", () => {
  it.each([
    {
      name: "explicit off wins",
      env: { NOVEL_EVALUATION_MODE: "off", NODE_ENV: "development" },
      expected: "off",
    },
    {
      name: "explicit shadow wins",
      env: { NOVEL_EVALUATION_MODE: "shadow", NODE_ENV: "production" },
      expected: "shadow",
    },
    {
      name: "explicit on wins",
      env: { NOVEL_EVALUATION_MODE: "on", NODE_ENV: "production" },
      expected: "on",
    },
    {
      name: "invalid + production → off",
      env: { NOVEL_EVALUATION_MODE: "maybe", NODE_ENV: "production" },
      expected: "off",
    },
    {
      name: "unset + production → off",
      env: { NODE_ENV: "production" },
      expected: "off",
    },
    {
      name: "invalid + non-production → shadow",
      env: { NOVEL_EVALUATION_MODE: "maybe", NODE_ENV: "development" },
      expected: "shadow",
    },
    {
      name: "unset + non-production → shadow",
      env: { NODE_ENV: "test" },
      expected: "shadow",
    },
  ] as const)("$name", ({ env, expected }) => {
    expect(resolveNovelEvaluationMode({ ...env })).toBe(expected);
  });
});
