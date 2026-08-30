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
  MAX_HINTS_PER_SESSION,
  RubricSchema,
  ClassifyResultSchema,
  parseRubric,
  initInsightResults,
  mergeInsightResults,
} from "./rubric.js";

export { computeScore, allInsightsResolved, hasUnresolvedInsights } from "./scoring.js";

export {
  scanWrongApproaches,
  synthesizeWrongApproachClassification,
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
