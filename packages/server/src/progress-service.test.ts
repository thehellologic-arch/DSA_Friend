import { describe, expect, it } from "vitest";
import type { Verdict } from "@reason/core";
import { MemoryProgressRepository } from "./memory-progress-repository.js";
import { ProgressService } from "./progress-service.js";

function makeVerdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    label: "optimal",
    score: 90,
    insights: [{ id: "complement", desc: "Use complement", status: "yes" }],
    suggestion: "Keep going.",
    idealSolution: {
      approach: "Hash set",
      keyInsight: "Lookup complement",
      complexity: { time: "O(n)", space: "O(n)" },
      examples: [],
    },
    hintsUsed: 0,
    exchanges: [],
    ...overrides,
  };
}

async function setup() {
  const repo = new MemoryProgressRepository();
  const service = new ProgressService(repo, () => []);
  await service.ensureUser("user-1", "beginner", ["hashing"]);
  return { repo, service };
}

function baseInput(verdict: Verdict, sessionId = "session-1") {
  return {
    userId: "user-1",
    sessionId,
    problemSlug: "two-sum-hash-set",
    pattern: "hashing",
    difficulty: 800,
    coreAsk: "Find two numbers that sum to target",
    selfCorrections: 0,
    transcript: [
      { role: "USER" as const, content: "I use a hash set." },
      { role: "AI" as const, content: "Verdict." },
    ],
    verdict,
  };
}

describe("ProgressService.recordVerdict rating policy", () => {
  it("records plausible_unverified without changing rating or mastery", async () => {
    const { repo, service } = await setup();
    const before = await repo.getTopicProgress("user-1", "hashing");
    expect(before).not.toBeNull();

    const verdict = makeVerdict({
      label: "plausible_unverified",
      score: 40,
      suggestion:
        "Unresolved: insert timing before or after the complement check.",
    });

    const update = await service.recordVerdict(baseInput(verdict));

    expect(update.ratingEligible).toBe(false);
    expect(update.ratingDelta).toBe(0);
    expect(update.ratingBefore).toBe(before!.rating);
    expect(update.ratingAfter).toBe(before!.rating);
    expect(update.masteryBefore).toBe(before!.masteryPercent);
    expect(update.masteryAfter).toBe(before!.masteryPercent);
    expect(update.validationStatus).toBe("plausible_unverified");
    expect(update.validationEvidence).toEqual([verdict.suggestion]);

    const attempts = await repo.listAttempts("user-1");
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.verdictLabel).toBe("plausible_unverified");
    expect(attempts[0]!.ratingBefore).toBe(before!.rating);
    expect(attempts[0]!.ratingAfter).toBe(before!.rating);
    expect(attempts[0]!.masteryBefore).toBe(before!.masteryPercent);
    expect(attempts[0]!.masteryAfter).toBe(before!.masteryPercent);

    const after = await repo.getTopicProgress("user-1", "hashing");
    expect(after!.rating).toBe(before!.rating);
    expect(after!.masteryPercent).toBe(before!.masteryPercent);
    expect(after!.problemsCompleted).toBe(before!.problemsCompleted);
    expect(after!.recentPerformance).toEqual(before!.recentPerformance);
    expect(repo.events).toHaveLength(0);
  });

  it("keeps optimal, acceptable, and incorrect rating-eligible", async () => {
    const { repo, service } = await setup();
    const labels = ["optimal", "acceptable", "incorrect"] as const;

    for (const [index, label] of labels.entries()) {
      const before = await repo.getTopicProgress("user-1", "hashing");
      const suggestion =
        label === "incorrect"
          ? "Counterexample: [1,1] with target 2 fails."
          : `Next step for ${label}.`;
      const update = await service.recordVerdict(
        baseInput(
          makeVerdict({
            label,
            score: label === "incorrect" ? 20 : 85,
            suggestion,
          }),
          `eligible-${label}-${index}`,
        ),
      );

      expect(update.ratingEligible).toBe(true);
      expect(update.validationStatus).toBe(label);
      expect(update.validationEvidence).toEqual([suggestion]);
      expect(update.ratingDelta).toBe(
        update.ratingAfter - update.ratingBefore,
      );

      const after = await repo.getTopicProgress("user-1", "hashing");
      expect(after!.problemsCompleted).toBe(before!.problemsCompleted + 1);
      expect(repo.events.at(-1)?.delta).toBe(update.ratingDelta);
    }
  });
});
