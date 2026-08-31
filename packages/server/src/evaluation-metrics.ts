export type NovelEvaluationMode = "off" | "shadow" | "on";

export interface NovelApproachEvaluationEvent {
  event: "novel_approach_evaluation";
  route: string | null;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
  cacheHit: boolean;
  challengeUsed: boolean;
  outcome: string;
}

export type EvaluationLogFn = (event: NovelApproachEvaluationEvent) => void;

export function resolveNovelEvaluationMode(
  env: NodeJS.ProcessEnv = process.env,
): NovelEvaluationMode {
  const explicit = env.NOVEL_EVALUATION_MODE;
  if (explicit === "off" || explicit === "shadow" || explicit === "on") {
    return explicit;
  }
  return env.NODE_ENV === "production" ? "off" : "shadow";
}

export function logNovelApproachEvaluation(
  event: NovelApproachEvaluationEvent,
  log: EvaluationLogFn = (payload) => {
    console.info(payload);
  },
): void {
  log(event);
}
