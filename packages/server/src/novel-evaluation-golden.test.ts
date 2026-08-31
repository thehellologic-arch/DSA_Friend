import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ApproachEvaluationSchema,
  evaluateEvidence,
  scanAcceptableAlternatives,
  scanTutorIntent,
  scanWrongApproaches,
  type ApproachEvaluation,
  type Rubric,
} from "@reason/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = path.resolve(__dirname, "../../../evaluation/two-sum.json");

const REQUIRED_CASE_IDS = [
  "canonical-hash-set",
  "sorting-two-pointers",
  "sorting-binary-search",
  "brute-force-pairs",
  "reuse-same-element",
  "duplicate-safe-novel",
  "duplicate-unsafe-novel",
  "underspecified-use-a-map",
  "novel-paraphrase",
  "irrelevant-off-topic",
  "correction-after-challenge",
] as const;

type ExpectedRoute =
  | "local_alternative"
  | "local_wrong"
  | "local_intent"
  | "known_canonical"
  | "novel"
  | "underspecified";

type ExpectedOutcome =
  | "optimal"
  | "acceptable"
  | "incorrect"
  | "plausible_unverified"
  | "novel_challenge"
  | "existing_tutor_path";

interface PriorTurn {
  role: string;
  content: string;
}

interface GoldenCase {
  id: string;
  inputText: string;
  priorTurns?: PriorTurn[];
  expectedRoute: ExpectedRoute;
  expectedOutcome: ExpectedOutcome;
  rationale: string;
  evaluatorFixture: ApproachEvaluation | null;
}

const twoSumRubric: Rubric = {
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
    examples: [],
  },
  acceptable_alternatives: [
    {
      id: "two_pointers",
      approach: "Sort the values and use two pointers.",
      note: "Correct in O(n log n) time, but hashing is faster on average.",
      match_signals: [
        "two pointer",
        "two pointers",
        "2 pointer",
        "left and right",
        "from both ends",
        "left pointer",
      ],
    },
  ],
  common_wrong_approaches: [
    {
      id: "brute_force_pairs",
      match_signals: ["nested loops", "check every pair", "all pairs", "brute force"],
      why_wrong: "Checking every pair works but takes O(n²) time.",
      counterexample: "A list with 100,000 values",
    },
    {
      id: "reuse_same_element",
      match_signals: ["target / 2", "same element twice", "reuse the element"],
      why_wrong:
        "A value cannot pair with itself unless it appears at least twice.",
      counterexample: "numbers = [3], target = 6",
    },
  ],
  required_insights: [
    {
      id: "complement",
      desc: "Computes target minus the current value",
      weight: 3,
      hints: ["a", "b", "c"],
    },
    {
      id: "hash_lookup",
      desc: "Uses a hash set for constant-time complement lookup",
      weight: 3,
      hints: ["a", "b", "c"],
    },
    {
      id: "distinct_elements",
      desc: "Checks before inserting to avoid reusing the same element",
      weight: 1,
      hints: ["a", "b", "c"],
    },
    {
      id: "complexity",
      desc: "States O(n) time and O(n) space",
      weight: 1,
      hints: ["a", "b", "c"],
    },
  ],
  edge_cases: [],
  scoring: {
    formula: "sum(weight of insights hit) / sum(all weights)",
    hint_penalty_per_reveal: 0.1,
    self_correction_bonus: 0.05,
  },
  validation: {
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
        tags: ["duplicates", "distinct_indices"],
      },
      {
        id: "no_match",
        input: { numbers: [1, 2, 4], target: 8 },
        tags: ["negative_result"],
      },
    ],
  },
};

function loadCorpus(): GoldenCase[] {
  const raw = JSON.parse(fs.readFileSync(CORPUS_PATH, "utf-8")) as
    | GoldenCase[]
    | { problemId: string; cases: GoldenCase[] };
  return Array.isArray(raw) ? raw : raw.cases;
}

function normalizeComplexity(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function mapSupportedLabel(
  evaluation: ApproachEvaluation,
): "optimal" | "acceptable" {
  const claimed = evaluation.approach.claimedComplexity?.time;
  if (claimed == null || claimed === "") return "acceptable";
  if (
    normalizeComplexity(claimed) ===
    normalizeComplexity(twoSumRubric.optimal.complexity.time)
  ) {
    return "optimal";
  }
  return "acceptable";
}

function hasPriorChallenge(priorTurns: PriorTurn[]): boolean {
  return priorTurns.some(
    (turn) =>
      (turn.role === "AI" || turn.role === "assistant") &&
      turn.content.trim().length > 0,
  );
}

function detectLocalRoute(inputText: string): ExpectedRoute | null {
  if (scanTutorIntent(inputText)) return "local_intent";
  if (scanWrongApproaches(inputText, twoSumRubric)) return "local_wrong";
  if (scanAcceptableAlternatives(inputText, twoSumRubric)) {
    return "local_alternative";
  }
  return null;
}

function deriveFixtureOutcome(
  evaluation: ApproachEvaluation,
  priorTurns: PriorTurn[],
): ExpectedOutcome {
  if (
    evaluation.messageKind === "off_topic" ||
    evaluation.messageKind === "sample_request" ||
    evaluation.messageKind === "pushback" ||
    evaluation.messageKind === "question"
  ) {
    return "existing_tutor_path";
  }

  const outcome = evaluateEvidence(twoSumRubric, evaluation);

  if (outcome.status === "incorrect") return "incorrect";

  if (outcome.status === "plausible_unverified") {
    const challengeText = evaluation.challenge?.trim() ?? "";
    if (!hasPriorChallenge(priorTurns) && challengeText.length > 0) {
      return "novel_challenge";
    }
    return "plausible_unverified";
  }

  return mapSupportedLabel(evaluation);
}

describe("novel evaluation golden corpus", () => {
  it("loads the Two Sum corpus from evaluation/two-sum.json", () => {
    expect(fs.existsSync(CORPUS_PATH)).toBe(true);
    const cases = loadCorpus();
    expect(cases.length).toBeGreaterThanOrEqual(REQUIRED_CASE_IDS.length);
  });

  it("covers every required expert-reviewed category", () => {
    const cases = loadCorpus();
    const ids = new Set(cases.map((c) => c.id));
    for (const requiredId of REQUIRED_CASE_IDS) {
      expect(ids.has(requiredId)).toBe(true);
    }
  });

  it("routes and scores every corpus case without calling a paid provider", () => {
    const cases = loadCorpus();

    for (const golden of cases) {
      const priorTurns = golden.priorTurns ?? [];

      if (golden.evaluatorFixture == null) {
        const localRoute = detectLocalRoute(golden.inputText);
        expect(localRoute, golden.id).toBe(golden.expectedRoute);
        expect(
          ["local_alternative", "local_wrong", "local_intent"],
          golden.id,
        ).toContain(golden.expectedRoute);
        expect(golden.expectedOutcome, golden.id).toBe("existing_tutor_path");
        continue;
      }

      const evaluation = ApproachEvaluationSchema.parse(
        golden.evaluatorFixture,
      );
      expect(evaluation.route, golden.id).toBe(golden.expectedRoute);

      const localRoute = detectLocalRoute(golden.inputText);
      expect(localRoute, `${golden.id} should not be stolen by local scan`).toBeNull();

      const outcome = deriveFixtureOutcome(evaluation, priorTurns);
      expect(outcome, golden.id).toBe(golden.expectedOutcome);

      if (golden.id === "correction-after-challenge") {
        expect(hasPriorChallenge(priorTurns)).toBe(true);
        expect(outcome).not.toBe("novel_challenge");
        expect(["optimal", "acceptable", "plausible_unverified"]).toContain(
          outcome,
        );
      }

      if (golden.id === "irrelevant-off-topic") {
        expect(evaluation.messageKind).toBe("off_topic");
      }

      if (golden.id === "duplicate-unsafe-novel") {
        const dup = evaluation.casePredictions.find(
          (p) => p.caseId === "duplicate_match",
        );
        expect(dup?.output).toBe(false);
      }

      if (golden.id === "duplicate-safe-novel") {
        const dup = evaluation.casePredictions.find(
          (p) => p.caseId === "duplicate_match",
        );
        expect(dup?.output).toBe(true);
      }
    }
  });
});
