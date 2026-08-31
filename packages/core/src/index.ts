export {
  type Rubric,
  type ClassifyResult,
  type ClassifyRequest,
  type SessionState,
  type InsightResult,
  type TurnView,
  type SessionContext,
  type Verdict,
  type FollowUpExchange,
  type TurnAction,
  type InsightStatus,
  type MessageKind,
  type ApproachModel,
  type ApproachEvaluation,
  type ValidationConfig,
  type ValidationOutcome,
  MAX_HINTS_PER_SESSION,
  RubricSchema,
  ClassifyResultSchema,
  ApproachModelSchema,
  ApproachEvaluationSchema,
  ValidationConfigSchema,
  parseRubric,
  initInsightResults,
  mergeInsightResults,
} from "./rubric.js";

export { computeScore, allInsightsResolved, hasUnresolvedInsights } from "./scoring.js";

export {
  scanWrongApproaches,
  scanAcceptableAlternatives,
  scanTutorIntent,
  synthesizeWrongApproachClassification,
  synthesizeAcceptableClassification,
  synthesizeIntentClassification,
} from "./layer1.js";

export {
  nextTurnAction,
  revealVerdict,
  applyHint,
  applyProbe,
  actionToAiMessage,
  buildExchangeReview,
  type AnnotatedTurn,
} from "./reasoning-core.js";

export {
  type SkillLevel,
  type TopicStatus,
  type LevelAvailability,
  type TopicProgress,
  REVIEW_AFTER_DAYS,
  MASTERY_THRESHOLD,
  LEVEL_CEILINGS,
  SKILL_LEVELS,
  isSkillLevel,
  computeMasteryPercent,
  ratingToLevel,
  difficultyToLevel,
  deriveTopicStatus,
  levelAvailability,
  levelBandLabel,
  availabilityLabel,
} from "./progress.js";

export {
  STARTING_RATING,
  DEFAULT_K,
  MIN_RATING,
  expectedScore,
  ratingDelta,
  applyRatingUpdate,
} from "./rating.js";

export {
  type RecommendableProblem,
  type RecommendContext,
  recommendProblems,
} from "./recommend.js";

export { evaluateEvidence } from "./approach-validation.js";
