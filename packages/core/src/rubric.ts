import { z } from "zod";

export const InsightStatusSchema = z.enum(["yes", "partial", "no"]);
export type InsightStatus = z.infer<typeof InsightStatusSchema>;

export const RubricSchema = z.object({
  problem_id: z.string(),
  rubric_version: z.number(),
  pattern: z.string(),
  difficulty: z.number(),
  core_ask: z.string(),
  optimal: z.object({
    approach: z.string(),
    complexity: z.object({
      time: z.string(),
      space: z.string(),
    }),
    key_insight: z.string(),
  }),
  acceptable_alternatives: z
    .array(
      z.object({
        approach: z.string(),
        note: z.string(),
      }),
    )
    .default([]),
  common_wrong_approaches: z.array(
    z.object({
      id: z.string(),
      match_signals: z.array(z.string()),
      why_wrong: z.string(),
      counterexample: z.string(),
    }),
  ),
  required_insights: z.array(
    z.object({
      id: z.string(),
      desc: z.string(),
      weight: z.number(),
      hints: z.array(z.string()),
      on_fail_suggestion: z.string().optional(),
    }),
  ),
  edge_cases: z.array(z.string()).default([]),
  scoring: z.object({
    formula: z.string(),
    hint_penalty_per_reveal: z.number(),
    self_correction_bonus: z.number(),
  }),
});

export type Rubric = z.infer<typeof RubricSchema>;

export const ClassifyResultSchema = z.object({
  insights: z.array(
    z.object({
      id: z.string(),
      status: InsightStatusSchema,
      evidence: z.string().nullable(),
    }),
  ),
  matchedWrongApproach: z.string().nullable(),
  claimsOptimal: z.boolean(),
  confidence: z.number(),
});

export type ClassifyResult = z.infer<typeof ClassifyResultSchema>;

export interface ClassifyRequest {
  coreAsk: string;
  requiredInsights: { id: string; desc: string }[];
  wrongApproaches: { id: string; whyWrong: string; signals: string[] }[];
  history: TurnView[];
  latestUserMessage: string;
}

export type SessionState =
  | "PITCH"
  | "AWAIT_APPROACH"
  | "FOLLOW_UP"
  | "VERDICT"
  | "COMMITTED";

export interface InsightResult {
  id: string;
  status: InsightStatus;
  evidence: string | null;
}

export interface TurnView {
  role: "USER" | "AI";
  content: string;
}

export interface SessionContext {
  state: SessionState;
  insightResults: InsightResult[];
  hintsUsed: number;
  hintsUsedByInsight: Record<string, number>;
  probesUsedByInsight: Record<string, number>;
  selfCorrections: number;
  hadWrongApproach: boolean;
}

export interface VerdictInsight {
  id: string;
  desc: string;
  status: InsightStatus;
}

export interface FollowUpExchange {
  kind: "follow_up" | "counterexample" | "hint";
  question: string;
  userAnswer: string;
  idealAnswer: string;
  insightId?: string;
}

export interface Verdict {
  label: "optimal" | "acceptable" | "buggy" | "incomplete";
  score: number;
  insights: VerdictInsight[];
  suggestion: string;
  hintsUsed: number;
  exchanges: FollowUpExchange[];
}

export type TurnAction =
  | { kind: "follow_up"; insightId: string; text: string }
  | { kind: "hint"; insightId: string; text: string }
  | { kind: "counterexample"; insightId: string; input: string; text: string }
  | { kind: "verdict"; verdict: Verdict };

export const MAX_HINTS_PER_SESSION = 1;

const STATUS_RANK: Record<InsightStatus, number> = {
  no: 0,
  partial: 1,
  yes: 2,
};

export function parseRubric(data: unknown): Rubric {
  return RubricSchema.parse(data);
}

export function initInsightResults(rubric: Rubric): InsightResult[] {
  return rubric.required_insights.map((insight) => ({
    id: insight.id,
    status: "no" as InsightStatus,
    evidence: null,
  }));
}

export function mergeInsightResults(
  current: InsightResult[],
  classified: ClassifyResult["insights"],
): InsightResult[] {
  const byId = new Map(current.map((r) => [r.id, { ...r }]));

  for (const item of classified) {
    const existing = byId.get(item.id);
    if (!existing) continue;

    if (STATUS_RANK[item.status] > STATUS_RANK[existing.status]) {
      existing.status = item.status;
      existing.evidence = item.evidence;
    } else if (
      item.status === existing.status &&
      item.evidence &&
      !existing.evidence
    ) {
      existing.evidence = item.evidence;
    }
  }

  return Array.from(byId.values());
}
