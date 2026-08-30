import type { SkillLevel, Verdict } from "@reason/core";

export interface UserRecord {
  id: string;
  skillLevel: SkillLevel;
  onboarded: boolean;
  createdAt: string;
}

export interface TopicProgressRow {
  userId: string;
  pattern: string;
  rating: number;
  masteryPercent: number;
  problemsCompleted: number;
  hintUsage: number;
  lastPracticedAt: string | null;
  recentPerformance: number[];
}

export interface StoredAttempt {
  id: string;
  userId: string;
  sessionId: string;
  problemSlug: string;
  pattern: string;
  difficulty: number;
  coreAsk: string;
  score: number;
  verdictLabel: Verdict["label"];
  hintsUsed: number;
  selfCorrections: number;
  insightResults: Verdict["insights"];
  ratingBefore: number;
  ratingAfter: number;
  masteryBefore: number;
  masteryAfter: number;
  newlyMasteredInsights: Verdict["insights"];
  transcript: { role: "USER" | "AI"; content: string }[];
  verdict: Verdict;
  completedAt: string;
}

export interface RatingEvent {
  id: string;
  userId: string;
  attemptId: string;
  pattern: string;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
  createdAt: string;
}

export interface CreateAttemptInput {
  id: string;
  userId: string;
  sessionId: string;
  problemSlug: string;
  pattern: string;
  difficulty: number;
  coreAsk: string;
  score: number;
  verdictLabel: Verdict["label"];
  hintsUsed: number;
  selfCorrections: number;
  insightResults: Verdict["insights"];
  ratingBefore: number;
  ratingAfter: number;
  masteryBefore: number;
  masteryAfter: number;
  newlyMasteredInsights: Verdict["insights"];
  transcript: { role: "USER" | "AI"; content: string }[];
  verdict: Verdict;
}

export interface ProgressRepository {
  createUser(
    id: string,
    skillLevel: SkillLevel,
    onboarded?: boolean,
  ): Promise<UserRecord>;
  getUser(id: string): Promise<UserRecord | null>;
  setSkillLevel(id: string, skillLevel: SkillLevel): Promise<UserRecord>;
  markOnboarded(id: string): Promise<UserRecord>;
  listTopicProgress(userId: string): Promise<TopicProgressRow[]>;
  getTopicProgress(
    userId: string,
    pattern: string,
  ): Promise<TopicProgressRow | null>;
  upsertTopicProgress(row: TopicProgressRow): Promise<TopicProgressRow>;
  insertAttempt(input: CreateAttemptInput): Promise<StoredAttempt>;
  getAttemptBySessionId(sessionId: string): Promise<StoredAttempt | null>;
  listAttempts(userId: string): Promise<StoredAttempt[]>;
  insertRatingEvent(
    event: Omit<RatingEvent, "createdAt"> & { createdAt?: string },
  ): Promise<RatingEvent>;
}
