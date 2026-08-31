import {
  ApproachEvaluationSchema,
  type ApproachEvaluation,
  type ApproachModel,
} from "@reason/core";
import { ZodError } from "zod";
import { APPROACH_EVALUATION_SYSTEM_PROMPT } from "./approach-evaluation-prompt.js";

export interface LlmUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface ApproachEvaluationRequest {
  coreAsk: string;
  constraints: string;
  cases: { id: string; input: unknown; tags?: string[] }[];
  priorApproach: ApproachModel | null;
  challengeAnswer: string | null;
  relevantQuotes: string[];
  latestUserMessage: string;
}

export interface ApproachCompletionResult {
  content: string;
  usage: LlmUsage;
}

export type ApproachCompletionFn = (
  systemPrompt: string,
  userContent: string,
) => Promise<ApproachCompletionResult>;

export class ApproachEvaluationUnavailableError extends Error {
  readonly usage: LlmUsage | null;

  constructor(
    message = "Approach evaluation unavailable",
    usage: LlmUsage | null = null,
  ) {
    super(message);
    this.name = "ApproachEvaluationUnavailableError";
    this.usage = usage;
  }
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object found in LLM response");
    return JSON.parse(match[0]);
  }
}

function isRetryableParseError(err: unknown): boolean {
  if (err instanceof ZodError) return true;
  if (err instanceof SyntaxError) return true;
  if (
    err instanceof Error &&
    err.message.includes("No JSON object found")
  ) {
    return true;
  }
  return false;
}

function buildUserPayload(input: ApproachEvaluationRequest) {
  return {
    coreAsk: input.coreAsk,
    constraints: input.constraints,
    cases: input.cases.map(({ id, input: caseInput }) => ({
      id,
      input: caseInput,
    })),
    priorApproach: input.priorApproach,
    challengeAnswer: input.challengeAnswer,
    relevantQuotes: input.relevantQuotes,
    latestUserMessage: input.latestUserMessage,
    schema: {
      messageKind: "approach|question|sample_request|pushback|off_topic",
      route: "known_canonical|novel|underspecified",
      canonicalInsights: [
        { id: "string", status: "yes|partial|no", evidence: "string|null" },
      ],
      approach: {
        steps: ["string"],
        state: ["string"],
        invariant: "string|null",
        claimedComplexity: {
          time: "string|null",
          space: "string|null",
        },
        assumptions: ["string"],
        evidence: [{ claim: "string", quote: "string" }],
        criticalGaps: ["string"],
      },
      casePredictions: [
        { caseId: "string", output: "unknown", reasoning: "string" },
      ],
      recommendation: "supported|refuted|challenge",
      challenge: "string|null",
      confidence: "0.0-1.0",
    },
  };
}

export async function evaluateApproach(
  input: ApproachEvaluationRequest,
  complete: ApproachCompletionFn,
): Promise<{ evaluation: ApproachEvaluation; usage: LlmUsage }> {
  const userContent = JSON.stringify(buildUserPayload(input));
  let lastError: Error | null = null;
  let lastUsage: LlmUsage | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    let usage: LlmUsage | null = null;
    try {
      const result = await complete(
        APPROACH_EVALUATION_SYSTEM_PROMPT,
        userContent,
      );
      usage = result.usage;
      lastUsage = usage;
      const evaluation = ApproachEvaluationSchema.parse(
        extractJson(result.content),
      );
      return { evaluation, usage };
    } catch (err) {
      if (!isRetryableParseError(err)) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      if (usage) lastUsage = usage;
    }
  }

  throw new ApproachEvaluationUnavailableError(
    lastError?.message ?? "Approach evaluation unavailable",
    lastUsage,
  );
}
