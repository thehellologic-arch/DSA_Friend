import { describe, expect, it, vi } from "vitest";
import type { ApproachModel } from "@reason/core";
import {
  ApproachEvaluationUnavailableError,
  evaluateApproach,
  type ApproachCompletionFn,
  type ApproachEvaluationRequest,
} from "./approach-evaluator.js";
import { APPROACH_EVALUATION_SYSTEM_PROMPT } from "./approach-evaluation-prompt.js";

const validEvaluation = {
  messageKind: "approach",
  route: "novel",
  canonicalInsights: [],
  approach: {
    steps: ["Scan once while tracking seen values."],
    state: ["A set of previously seen numbers."],
    invariant: null,
    claimedComplexity: { time: "O(n)", space: "O(n)" },
    assumptions: [],
    evidence: [
      {
        claim: "Uses a hash set",
        quote: "I keep a set of numbers I have already seen",
      },
    ],
    criticalGaps: [],
  },
  casePredictions: [
    {
      caseId: "basic_match",
      output: true,
      reasoning: "2 and 7 sum to 9",
    },
  ],
  recommendation: "supported",
  challenge: null,
  confidence: 0.85,
};

const priorApproach: ApproachModel = {
  steps: ["Sort then use two pointers."],
  state: ["left", "right"],
  invariant: null,
  claimedComplexity: { time: "O(n log n)", space: "O(1)" },
  assumptions: ["Sorting a copy is allowed"],
  evidence: [{ claim: "sort first", quote: "I will sort the array" }],
  criticalGaps: ["Does not say how ties are handled"],
};

function baseRequest(
  overrides: Partial<ApproachEvaluationRequest> = {},
): ApproachEvaluationRequest {
  return {
    coreAsk: "Return whether any two numbers sum to the target.",
    constraints:
      "Need an O(n) pass with a hash set of previously seen values.",
    cases: [
      {
        id: "basic_match",
        input: { numbers: [2, 7, 11, 15], target: 9 },
        tags: ["smoke"],
      },
    ],
    priorApproach: null,
    challengeAnswer: null,
    relevantQuotes: ["I keep a set of numbers I have already seen"],
    latestUserMessage:
      "I keep a set of numbers I have already seen and check complements.",
    ...overrides,
  };
}

function successfulCompletion(
  evaluation = validEvaluation,
): ApproachCompletionFn {
  return vi.fn(async () => ({
    content: JSON.stringify(evaluation),
    usage: {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    },
  }));
}

describe("evaluateApproach", () => {
  it("sends only case ids and inputs, never oracle outputs", async () => {
    const complete = successfulCompletion();
    const oracleOutput = [0, 1];

    await evaluateApproach(
      baseRequest({
        cases: [
          {
            id: "basic_match",
            input: { numbers: [2, 7, 11, 15], target: 9 },
            tags: ["smoke"],
          },
        ],
      }),
      complete,
    );

    expect(complete).toHaveBeenCalledTimes(1);
    const [, userContent] = vi.mocked(complete).mock.calls[0]!;
    const payload = JSON.parse(userContent) as {
      cases: Record<string, unknown>[];
    };

    expect(payload.cases).toEqual([
      { id: "basic_match", input: { numbers: [2, 7, 11, 15], target: 9 } },
    ]);
    expect(userContent).not.toContain("expected");
    expect(userContent).not.toContain(JSON.stringify(oracleOutput));
    for (const testCase of payload.cases) {
      expect(Object.keys(testCase).sort()).toEqual(["id", "input"]);
    }
  });

  it("requires direct evidence quotes in the system prompt and includes relevantQuotes", async () => {
    const complete = successfulCompletion();
    const request = baseRequest();

    await evaluateApproach(request, complete);

    const [systemPrompt, userContent] = vi.mocked(complete).mock.calls[0]!;
    expect(systemPrompt).toBe(APPROACH_EVALUATION_SYSTEM_PROMPT);
    expect(systemPrompt).toContain(
      "Every supported claim must quote the student",
    );
    expect(userContent).toContain('"relevantQuotes"');
    expect(JSON.parse(userContent).relevantQuotes).toEqual(
      request.relevantQuotes,
    );
  });

  it("retries invalid JSON once and succeeds on the second attempt", async () => {
    const complete = vi
      .fn<ApproachCompletionFn>()
      .mockResolvedValueOnce({
        content: "not-json{{{",
        usage: {
          promptTokens: 10,
          completionTokens: 2,
          totalTokens: 12,
        },
      })
      .mockResolvedValueOnce({
        content: JSON.stringify(validEvaluation),
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      });

    const result = await evaluateApproach(baseRequest(), complete);

    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.evaluation.route).toBe("novel");
    expect(result.usage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
  });

  it("throws ApproachEvaluationUnavailableError after a second invalid result", async () => {
    const complete = vi.fn<ApproachCompletionFn>().mockResolvedValue({
      content: '{"route":"not-a-real-route"}',
      usage: {
        promptTokens: 11,
        completionTokens: 7,
        totalTokens: 18,
      },
    });

    const err = await evaluateApproach(baseRequest(), complete).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApproachEvaluationUnavailableError);
    expect(complete).toHaveBeenCalledTimes(2);
    expect((err as ApproachEvaluationUnavailableError).usage).toEqual({
      promptTokens: 11,
      completionTokens: 7,
      totalTokens: 18,
    });
  });

  it("does not retry network errors and rethrows them immediately", async () => {
    const networkError = new Error("fetch failed: ECONNRESET");
    const complete = vi.fn<ApproachCompletionFn>().mockRejectedValue(networkError);

    await expect(evaluateApproach(baseRequest(), complete)).rejects.toBe(
      networkError,
    );
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("excludes unrelated transcript history from the completion payload", async () => {
    const complete = successfulCompletion();
    const weather = "What's the weather in Seattle today?";

    await evaluateApproach(baseRequest(), complete);

    const [, userContent] = vi.mocked(complete).mock.calls[0]!;
    expect(userContent).not.toContain(weather);
    expect(userContent).not.toContain('"history"');
    expect(JSON.parse(userContent).latestUserMessage).toBe(
      baseRequest().latestUserMessage,
    );
  });

  it("includes priorApproach and challengeAnswer on a second evaluation", async () => {
    const complete = successfulCompletion();
    const challengeAnswer =
      "When I see a duplicate I still check whether target - x is already in the set.";

    await evaluateApproach(
      baseRequest({
        priorApproach,
        challengeAnswer,
      }),
      complete,
    );

    const [, userContent] = vi.mocked(complete).mock.calls[0]!;
    const payload = JSON.parse(userContent) as {
      priorApproach: ApproachModel;
      challengeAnswer: string;
    };

    expect(payload.priorApproach).toEqual(priorApproach);
    expect(payload.challengeAnswer).toBe(challengeAnswer);
  });
});
