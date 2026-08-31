import { describe, expect, it, vi } from "vitest";
import type {
  ApproachEvaluation,
  ApproachModel,
  ClassifyResult,
  Rubric,
} from "@reason/core";
import {
  ApproachEvaluationUnavailableError,
  type ApproachEvaluationRequest,
} from "./approach-evaluator.js";
import { JudgingService } from "./judging-service.js";
import { MemoryProgressRepository } from "./memory-progress-repository.js";
import type { LLMProvider } from "./ollama-provider.js";
import { ProgressService } from "./progress-service.js";
import { InMemorySessionStore } from "./session-store.js";

const emptyApproach: ApproachModel = {
  steps: ["Scan with a hash set."],
  state: ["seen set"],
  invariant: null,
  claimedComplexity: { time: "O(n)", space: "O(n)" },
  assumptions: [],
  evidence: [{ claim: "hash set", quote: "I keep a set of seen values" }],
  criticalGaps: [],
};

function twoSumRubric(withValidation: boolean): Rubric {
  return {
    problem_id: "two-sum-hash-set",
    rubric_version: 1,
    pattern: "hashing",
    difficulty: 900,
    core_ask:
      "Given a list of numbers and a target, determine whether any two different elements add up to the target.",
    optimal: {
      approach:
        "Scan once while storing previously seen values in a hash set; for each value, check whether target minus that value has already been seen.",
      complexity: { time: "O(n)", space: "O(n)" },
      key_insight:
        "Looking up each required complement in a hash set avoids checking every pair.",
      examples: [
        {
          input: "numbers = [2,7,11,15], target = 9",
          output: "true",
          explanation: "When scanning 7, its complement 2 is already in the set.",
        },
      ],
    },
    acceptable_alternatives: [
      {
        id: "two_pointers",
        approach: "Sort the values and use two pointers.",
        note: "Correct in O(n log n) time, but hashing is faster on average.",
        match_signals: ["two pointer", "two pointers", "left and right"],
      },
    ],
    common_wrong_approaches: [
      {
        id: "brute_force_pairs",
        match_signals: ["nested loops", "check every pair", "brute force"],
        why_wrong: "Checking every pair works but takes O(n²) time.",
        counterexample: "A list with 100,000 values",
      },
    ],
    required_insights: [
      {
        id: "complement",
        desc: "Computes target minus the current value",
        weight: 3,
        hints: ["hint1", "hint2", "hint3"],
      },
      {
        id: "hash_lookup",
        desc: "Uses a hash set for constant-time complement lookup",
        weight: 3,
        hints: ["hint1", "hint2", "hint3"],
      },
    ],
    edge_cases: [],
    scoring: {
      formula: "sum(weight of insights hit) / sum(all weights)",
      hint_penalty_per_reveal: 0.1,
      self_correction_bonus: 0.05,
    },
    validation: withValidation
      ? {
          oracle: "two_sum_exists",
          cases: [
            {
              id: "basic_match",
              input: { numbers: [2, 7, 11, 15], target: 9 },
              tags: ["basic"],
            },
            {
              id: "duplicate_match",
              input: { numbers: [3, 3], target: 6 },
              tags: ["duplicates"],
            },
            {
              id: "no_match",
              input: { numbers: [1, 2, 4], target: 8 },
              tags: ["negative_result"],
            },
          ],
        }
      : undefined,
  };
}

function makeEvaluation(
  overrides: Partial<ApproachEvaluation> = {},
): ApproachEvaluation {
  return {
    messageKind: "approach",
    route: "novel",
    canonicalInsights: [],
    approach: emptyApproach,
    casePredictions: [
      { caseId: "basic_match", output: true, reasoning: "2+7" },
      { caseId: "duplicate_match", output: true, reasoning: "3+3" },
      { caseId: "no_match", output: false, reasoning: "no pair" },
    ],
    recommendation: "supported",
    challenge: null,
    confidence: 0.9,
    ...overrides,
  };
}

function classifyResult(
  overrides: Partial<ClassifyResult> = {},
): ClassifyResult {
  return {
    insights: [
      { id: "complement", status: "no", evidence: null },
      { id: "hash_lookup", status: "no", evidence: null },
    ],
    matchedWrongApproach: null,
    matchedAcceptableAlternative: null,
    claimsOptimal: false,
    confidence: 0.8,
    messageKind: "approach",
    ...overrides,
  };
}

async function createHarness(withValidation: boolean) {
  const store = new InMemorySessionStore();
  const classify = vi.fn(async () => classifyResult());
  const evaluateApproach = vi.fn(
    async (_req: ApproachEvaluationRequest) => ({
      evaluation: makeEvaluation(),
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
    }),
  );
  const llm: LLMProvider = {
    classify,
    clarify: vi.fn(async () => "clarified"),
    evaluateApproach,
  };
  const progress = new ProgressService(new MemoryProgressRepository(), () => []);
  await progress.ensureUser("user-1", "beginner", ["hashing"]);
  const judging = new JudgingService(store, llm, progress);
  const session = store.create(
    "two-sum-hash-set",
    twoSumRubric(withValidation),
    "user-1",
  );
  return { store, llm, classify, evaluateApproach, judging, session };
}

describe("JudgingService novel routing", () => {
  it("keeps a known alternative on the deterministic path", async () => {
    const { judging, session, classify, evaluateApproach } =
      await createHarness(true);

    const response = await judging.handleTurn(
      session.id,
      "I would sort then use two pointers from both ends",
      "k1",
    );

    expect(evaluateApproach).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
    expect(response.action.kind).toBe("follow_up");
    expect(session.context.lastAcceptableAlternative).toBe("two_pointers");
  });

  it("invokes the novel evaluator for an unmatched approach with validation", async () => {
    const { judging, session, classify, evaluateApproach } =
      await createHarness(true);
    evaluateApproach.mockResolvedValueOnce({
      evaluation: makeEvaluation({
        route: "novel",
        approach: {
          ...emptyApproach,
          criticalGaps: ["Does not say when values are inserted"],
        },
        recommendation: "challenge",
        challenge: "When do you insert the current value into the set?",
        casePredictions: [],
      }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    await judging.handleTurn(
      session.id,
      "I keep a set of numbers I have already seen and check complements.",
      "k1",
    );

    expect(evaluateApproach).toHaveBeenCalledTimes(1);
    expect(classify).not.toHaveBeenCalled();
    const req = evaluateApproach.mock.calls[0]![0] as ApproachEvaluationRequest;
    expect(req.cases.map((c) => c.id)).toEqual([
      "basic_match",
      "duplicate_match",
      "no_match",
    ]);
    expect(req.relevantQuotes).toContain(
      "I keep a set of numbers I have already seen and check complements.",
    );
    expect(req.challengeAnswer).toBeNull();
    expect(req.priorApproach).toBeNull();
    expect(req.constraints).not.toContain(session.rubric.optimal.approach);
    expect(req.constraints).not.toContain(session.rubric.optimal.key_insight);
  });

  it("does not leak the canonical approach into evaluator constraints", async () => {
    const { judging, session, evaluateApproach } = await createHarness(true);
    evaluateApproach.mockResolvedValueOnce({
      evaluation: makeEvaluation({
        approach: {
          ...emptyApproach,
          criticalGaps: ["gap"],
        },
        casePredictions: [],
        recommendation: "challenge",
        challenge: "Clarify insert order.",
      }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    await judging.handleTurn(session.id, "A novel hashing walkthrough.", "k1");

    const req = evaluateApproach.mock.calls[0]![0] as ApproachEvaluationRequest;
    expect(req.constraints).not.toContain(session.rubric.optimal.approach);
    expect(req.constraints).not.toContain(session.rubric.optimal.key_insight);
    for (const example of session.rubric.optimal.examples) {
      expect(req.constraints).not.toContain(example.output);
    }
    expect(req.constraints).toMatch(/O\(n\)/);
  });

  it("clears a pending novel challenge when a local fast path diverts", async () => {
    const { judging, session, evaluateApproach } = await createHarness(true);
    evaluateApproach
      .mockResolvedValueOnce({
        evaluation: makeEvaluation({
          approach: {
            ...emptyApproach,
            criticalGaps: ["Insert timing unclear"],
          },
          casePredictions: [],
          recommendation: "challenge",
          challenge: "When do you insert?",
        }),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      })
      .mockResolvedValueOnce({
        evaluation: makeEvaluation({
          approach: {
            ...emptyApproach,
            criticalGaps: ["Still gaps after divert"],
          },
          casePredictions: [],
          recommendation: "challenge",
          challenge: "Would be a second challenge",
        }),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });

    await judging.handleTurn(
      session.id,
      "I keep a set and look for complements.",
      "k1",
    );
    expect(session.context.pendingNovelChallenge).toBe("When do you insert?");
    expect(session.context.novelChallengeUsed).toBe(true);

    const sampleResponse = await judging.handleTurn(
      session.id,
      "Can you give me a sample input?",
      "k2",
    );
    expect(sampleResponse.action.kind).toBe("clarification");
    expect(session.context.pendingNovelChallenge).toBeNull();
    expect(session.context.novelChallengeUsed).toBe(true);
    expect(evaluateApproach).toHaveBeenCalledTimes(1);

    const later = await judging.handleTurn(
      session.id,
      "I scan once with a hash set of previously seen values.",
      "k3",
    );

    expect(evaluateApproach).toHaveBeenCalledTimes(2);
    const secondReq = evaluateApproach.mock
      .calls[1]![0] as ApproachEvaluationRequest;
    expect(secondReq.challengeAnswer).toBeNull();
    expect(secondReq.priorApproach).toBeNull();
    expect(secondReq.latestUserMessage).toBe(
      "I scan once with a hash set of previously seen values.",
    );
    expect(later.action.kind).toBe("verdict");
    if (later.action.kind === "verdict") {
      expect(later.action.verdict.label).toBe("plausible_unverified");
    }
    expect(later.action.kind).not.toBe("novel_challenge");
  });

  it("creates an optimal verdict when supported evidence matches target complexity", async () => {
    const { judging, session, evaluateApproach } = await createHarness(true);
    evaluateApproach.mockResolvedValueOnce({
      evaluation: makeEvaluation({
        approach: {
          ...emptyApproach,
          claimedComplexity: { time: "O(n)", space: "O(n)" },
        },
      }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const response = await judging.handleTurn(
      session.id,
      "Hash set of seen values, O(n) time.",
      "k1",
    );

    expect(response.action.kind).toBe("verdict");
    if (response.action.kind === "verdict") {
      expect(response.action.verdict.label).toBe("optimal");
    }
    expect(session.context.state).toBe("VERDICT");
  });

  it("creates an acceptable verdict when gates pass but complexity differs", async () => {
    const { judging, session, evaluateApproach } = await createHarness(true);
    evaluateApproach.mockResolvedValueOnce({
      evaluation: makeEvaluation({
        approach: {
          ...emptyApproach,
          claimedComplexity: { time: "O(n log n)", space: "O(1)" },
        },
      }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const response = await judging.handleTurn(
      session.id,
      "I partition into buckets by value and scan neighbors in O(n log n).",
      "k1",
    );

    expect(response.action.kind).toBe("verdict");
    if (response.action.kind === "verdict") {
      expect(response.action.verdict.label).toBe("acceptable");
    }
  });

  it("creates an incorrect verdict with the failing case on mismatched prediction", async () => {
    const { judging, session, evaluateApproach } = await createHarness(true);
    evaluateApproach.mockResolvedValueOnce({
      evaluation: makeEvaluation({
        casePredictions: [
          { caseId: "basic_match", output: true, reasoning: "ok" },
          { caseId: "duplicate_match", output: false, reasoning: "wrong" },
          { caseId: "no_match", output: false, reasoning: "ok" },
        ],
        recommendation: "refuted",
      }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const response = await judging.handleTurn(
      session.id,
      "I use a set but skip duplicates somehow.",
      "k1",
    );

    expect(response.action.kind).toBe("verdict");
    if (response.action.kind === "verdict") {
      expect(response.action.verdict.label).toBe("incorrect");
      expect(response.action.verdict.suggestion).toContain("duplicate_match");
    }
  });

  it("asks one challenge when evidence is incomplete", async () => {
    const { judging, session, evaluateApproach } = await createHarness(true);
    const challengeText =
      "When do you insert the current value relative to the complement check?";
    evaluateApproach.mockResolvedValueOnce({
      evaluation: makeEvaluation({
        approach: {
          ...emptyApproach,
          criticalGaps: ["Insert timing unclear"],
        },
        casePredictions: [],
        recommendation: "challenge",
        challenge: challengeText,
      }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const response = await judging.handleTurn(
      session.id,
      "I keep a set and look for complements.",
      "k1",
    );

    expect(response.action).toEqual({
      kind: "novel_challenge",
      text: challengeText,
    });
    expect(session.context.novelChallengeUsed).toBe(true);
    expect(session.context.pendingNovelChallenge).toBe(challengeText);
    expect(session.context.approachModel).toEqual({
      ...emptyApproach,
      criticalGaps: ["Insert timing unclear"],
    });
    expect(session.context.hintsUsed).toBe(0);
    expect(session.context.probesUsedByInsight).toEqual({});
  });

  it("passes the stored approach model when answering a challenge", async () => {
    const { judging, session, evaluateApproach } = await createHarness(true);
    const prior = {
      ...emptyApproach,
      criticalGaps: ["Insert timing unclear"],
    };
    evaluateApproach
      .mockResolvedValueOnce({
        evaluation: makeEvaluation({
          approach: prior,
          casePredictions: [],
          recommendation: "challenge",
          challenge: "When do you insert?",
        }),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      })
      .mockResolvedValueOnce({
        evaluation: makeEvaluation({
          approach: {
            ...emptyApproach,
            criticalGaps: [],
            claimedComplexity: { time: "O(n)", space: "O(n)" },
          },
        }),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });

    await judging.handleTurn(
      session.id,
      "I keep a set and look for complements.",
      "k1",
    );

    const answer = "I check the complement before inserting the current value.";
    const response = await judging.handleTurn(session.id, answer, "k2");

    expect(evaluateApproach).toHaveBeenCalledTimes(2);
    const secondReq = evaluateApproach.mock
      .calls[1]![0] as ApproachEvaluationRequest;
    expect(secondReq.challengeAnswer).toBe(answer);
    expect(secondReq.priorApproach).toEqual(prior);
    expect(session.context.pendingNovelChallenge).toBeNull();
    expect(response.action.kind).toBe("verdict");
    if (response.action.kind === "verdict") {
      expect(response.action.verdict.label).toBe("optimal");
    }
  });

  it("emits plausible_unverified when ambiguity remains after a challenge", async () => {
    const { judging, session, evaluateApproach } = await createHarness(true);
    evaluateApproach
      .mockResolvedValueOnce({
        evaluation: makeEvaluation({
          approach: {
            ...emptyApproach,
            criticalGaps: ["gap"],
          },
          casePredictions: [],
          recommendation: "challenge",
          challenge: "Clarify the insert order.",
        }),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      })
      .mockResolvedValueOnce({
        evaluation: makeEvaluation({
          approach: {
            ...emptyApproach,
            criticalGaps: ["Still unclear"],
          },
          casePredictions: [],
          recommendation: "challenge",
          challenge: "Still need more detail.",
        }),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });

    await judging.handleTurn(session.id, "Hash set approach vaguely.", "k1");
    const response = await judging.handleTurn(
      session.id,
      "I insert somehow.",
      "k2",
    );

    expect(response.action.kind).toBe("verdict");
    if (response.action.kind === "verdict") {
      expect(response.action.verdict.label).toBe("plausible_unverified");
    }
    expect(session.context.novelChallengeUsed).toBe(true);
  });

  it("never issues a second challenge", async () => {
    const { judging, session, evaluateApproach } = await createHarness(true);
    session.context.novelChallengeUsed = true;
    session.context.approachModel = emptyApproach;
    evaluateApproach.mockResolvedValueOnce({
      evaluation: makeEvaluation({
        approach: {
          ...emptyApproach,
          criticalGaps: ["Still gaps"],
        },
        casePredictions: [],
        recommendation: "challenge",
        challenge: "Would be a second challenge",
      }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const response = await judging.handleTurn(
      session.id,
      "Another attempt at a novel method.",
      "k1",
    );

    expect(response.action.kind).toBe("verdict");
    if (response.action.kind === "verdict") {
      expect(response.action.verdict.label).toBe("plausible_unverified");
    }
    expect(response.action.kind).not.toBe("novel_challenge");
  });

  it("uses the existing classify path when the rubric has no validation", async () => {
    const { judging, session, classify, evaluateApproach } =
      await createHarness(false);
    classify.mockResolvedValueOnce(
      classifyResult({
        insights: [
          { id: "complement", status: "partial", evidence: "mentions complement" },
          { id: "hash_lookup", status: "no", evidence: null },
        ],
      }),
    );

    const response = await judging.handleTurn(
      session.id,
      "I keep a set of numbers I have already seen and check complements.",
      "k1",
    );

    expect(classify).toHaveBeenCalledTimes(1);
    expect(evaluateApproach).not.toHaveBeenCalled();
    expect(response.action.kind).toBe("follow_up");
  });

  it("returns plausible_unverified when the evaluator is unavailable", async () => {
    const { judging, session, evaluateApproach, classify } =
      await createHarness(true);
    evaluateApproach.mockRejectedValueOnce(
      new ApproachEvaluationUnavailableError("boom"),
    );

    const response = await judging.handleTurn(
      session.id,
      "Novel hashing walkthrough.",
      "k1",
    );

    expect(classify).not.toHaveBeenCalled();
    expect(response.action.kind).toBe("verdict");
    if (response.action.kind === "verdict") {
      expect(response.action.verdict.label).toBe("plausible_unverified");
    }
  });

  it("initializes novel session fields on create", async () => {
    const { session } = await createHarness(true);
    expect(session.context.approachModel).toBeNull();
    expect(session.context.novelChallengeUsed).toBe(false);
    expect(session.context.pendingNovelChallenge).toBeNull();
  });
});
