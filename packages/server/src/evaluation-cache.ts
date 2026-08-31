import { createHash } from "node:crypto";
import {
  ApproachEvaluationSchema,
  type ApproachEvaluation,
  type ApproachModel,
} from "@reason/core";

export const MAX_ENTRIES = 1000;
export const TTL_MS = 24 * 60 * 60 * 1000;

export interface EvaluationCacheKeyInput {
  rubricVersion: number;
  model: string;
  promptVersion: string;
  /** Prior approach, or normalized student approach text on first pass. */
  approachModel: ApproachModel | string | null;
  cases: { id: string; input: unknown }[];
  challengeAnswer: string | null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonicalize((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}

function normalizeApproachModel(
  approachModel: ApproachModel | string | null,
): unknown {
  if (typeof approachModel === "string") {
    return approachModel.trim().toLowerCase().replace(/\s+/g, " ");
  }
  return approachModel;
}

function normalizeCases(
  cases: { id: string; input: unknown }[],
): { id: string; input: unknown }[] {
  return [...cases]
    .map((c) => ({ id: c.id, input: canonicalize(c.input) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function buildEvaluationCacheKey(
  input: EvaluationCacheKeyInput,
): string {
  const payload = {
    rubricVersion: input.rubricVersion,
    model: input.model,
    promptVersion: input.promptVersion,
    approachModel: normalizeApproachModel(input.approachModel),
    cases: normalizeCases(input.cases),
    challengeAnswer:
      input.challengeAnswer == null
        ? null
        : input.challengeAnswer.trim().toLowerCase().replace(/\s+/g, " "),
  };
  const canonical = JSON.stringify(canonicalize(payload));
  return createHash("sha256").update(canonical).digest("hex");
}

interface CacheEntry {
  value: ApproachEvaluation;
  expiresAt: number;
}

export class EvaluationCache {
  private readonly entries = new Map<string, CacheEntry>();

  get(key: string): ApproachEvaluation | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh LRU order
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: ApproachEvaluation): void {
    const parsed = ApproachEvaluationSchema.parse(value);
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    while (this.entries.size >= MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, {
      value: parsed,
      expiresAt: Date.now() + TTL_MS,
    });
  }
}
