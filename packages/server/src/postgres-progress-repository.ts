import type { SkillLevel, Verdict } from "@reason/core";
import type { Pool } from "pg";
import type {
  CreateAttemptInput,
  ProgressRepository,
  RatingEvent,
  StoredAttempt,
  TopicProgressRow,
  UserRecord,
} from "./progress-repository.js";

interface UserRow {
  id: string;
  skill_level: SkillLevel;
  onboarded: boolean;
  created_at: Date | string;
}

interface TopicRow {
  user_id: string;
  pattern: string;
  rating: number;
  mastery_percent: number;
  problems_completed: number;
  hint_usage: number;
  last_practiced_at: Date | string | null;
  recent_performance: number[] | string;
}

interface AttemptRow {
  id: string;
  user_id: string;
  session_id: string;
  problem_slug: string;
  pattern: string;
  difficulty: number;
  core_ask: string;
  score: number;
  verdict_label: Verdict["label"];
  hints_used: number;
  self_corrections: number;
  insight_results: Verdict["insights"] | string;
  rating_before: number;
  rating_after: number;
  mastery_before: number;
  mastery_after: number;
  newly_mastered_insights: Verdict["insights"] | string;
  transcript: StoredAttempt["transcript"] | string;
  verdict: Verdict | string;
  completed_at: Date | string;
}

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function jsonValue<T>(value: T | string): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    skillLevel: row.skill_level,
    onboarded: row.onboarded,
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
  };
}

function toTopic(row: TopicRow): TopicProgressRow {
  return {
    userId: row.user_id,
    pattern: row.pattern,
    rating: row.rating,
    masteryPercent: row.mastery_percent,
    problemsCompleted: row.problems_completed,
    hintUsage: row.hint_usage,
    lastPracticedAt: iso(row.last_practiced_at),
    recentPerformance: jsonValue<number[]>(row.recent_performance),
  };
}

function toAttempt(row: AttemptRow): StoredAttempt {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    problemSlug: row.problem_slug,
    pattern: row.pattern,
    difficulty: row.difficulty,
    coreAsk: row.core_ask,
    score: row.score,
    verdictLabel: row.verdict_label,
    hintsUsed: row.hints_used,
    selfCorrections: row.self_corrections,
    insightResults: jsonValue(row.insight_results),
    ratingBefore: row.rating_before,
    ratingAfter: row.rating_after,
    masteryBefore: row.mastery_before,
    masteryAfter: row.mastery_after,
    newlyMasteredInsights: jsonValue(row.newly_mastered_insights),
    transcript: jsonValue(row.transcript),
    verdict: jsonValue(row.verdict),
    completedAt: iso(row.completed_at) ?? new Date().toISOString(),
  };
}

export class PostgresProgressRepository implements ProgressRepository {
  constructor(private pool: Pool) {}

  async createUser(
    id: string,
    skillLevel: SkillLevel,
    onboarded = false,
  ): Promise<UserRecord> {
    const result = await this.pool.query<UserRow>(
      `INSERT INTO users (id, skill_level, onboarded)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET id = users.id
       RETURNING id, skill_level, onboarded, created_at`,
      [id, skillLevel, onboarded],
    );
    return toUser(result.rows[0]);
  }

  async getUser(id: string): Promise<UserRecord | null> {
    const result = await this.pool.query<UserRow>(
      `SELECT id, skill_level, onboarded, created_at FROM users WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toUser(result.rows[0]) : null;
  }

  async setSkillLevel(id: string, skillLevel: SkillLevel): Promise<UserRecord> {
    const result = await this.pool.query<UserRow>(
      `UPDATE users SET skill_level = $2 WHERE id = $1
       RETURNING id, skill_level, onboarded, created_at`,
      [id, skillLevel],
    );
    if (!result.rows[0]) throw new Error("User not found");
    return toUser(result.rows[0]);
  }

  async markOnboarded(id: string): Promise<UserRecord> {
    const result = await this.pool.query<UserRow>(
      `UPDATE users SET onboarded = true WHERE id = $1
       RETURNING id, skill_level, onboarded, created_at`,
      [id],
    );
    if (!result.rows[0]) throw new Error("User not found");
    return toUser(result.rows[0]);
  }

  async listTopicProgress(userId: string): Promise<TopicProgressRow[]> {
    const result = await this.pool.query<TopicRow>(
      `SELECT user_id, pattern, rating, mastery_percent, problems_completed,
              hint_usage, last_practiced_at, recent_performance
       FROM topic_progress WHERE user_id = $1`,
      [userId],
    );
    return result.rows.map(toTopic);
  }

  async getTopicProgress(
    userId: string,
    pattern: string,
  ): Promise<TopicProgressRow | null> {
    const result = await this.pool.query<TopicRow>(
      `SELECT user_id, pattern, rating, mastery_percent, problems_completed,
              hint_usage, last_practiced_at, recent_performance
       FROM topic_progress WHERE user_id = $1 AND pattern = $2`,
      [userId, pattern],
    );
    return result.rows[0] ? toTopic(result.rows[0]) : null;
  }

  async upsertTopicProgress(row: TopicProgressRow): Promise<TopicProgressRow> {
    const result = await this.pool.query<TopicRow>(
      `INSERT INTO topic_progress (
         user_id, pattern, rating, mastery_percent, problems_completed,
         hint_usage, last_practiced_at, recent_performance
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (user_id, pattern) DO UPDATE SET
         rating = EXCLUDED.rating,
         mastery_percent = EXCLUDED.mastery_percent,
         problems_completed = EXCLUDED.problems_completed,
         hint_usage = EXCLUDED.hint_usage,
         last_practiced_at = EXCLUDED.last_practiced_at,
         recent_performance = EXCLUDED.recent_performance
       RETURNING user_id, pattern, rating, mastery_percent, problems_completed,
                 hint_usage, last_practiced_at, recent_performance`,
      [
        row.userId,
        row.pattern,
        row.rating,
        row.masteryPercent,
        row.problemsCompleted,
        row.hintUsage,
        row.lastPracticedAt,
        JSON.stringify(row.recentPerformance),
      ],
    );
    return toTopic(result.rows[0]);
  }

  async insertAttempt(input: CreateAttemptInput): Promise<StoredAttempt> {
    const result = await this.pool.query<AttemptRow>(
      `INSERT INTO attempts (
         id, user_id, session_id, problem_slug, pattern, difficulty, core_ask,
         score, verdict_label, hints_used, self_corrections, insight_results,
         rating_before, rating_after, mastery_before, mastery_after,
         newly_mastered_insights, transcript, verdict
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,
         $17::jsonb,$18::jsonb,$19::jsonb
       )
       RETURNING *`,
      [
        input.id,
        input.userId,
        input.sessionId,
        input.problemSlug,
        input.pattern,
        input.difficulty,
        input.coreAsk,
        input.score,
        input.verdictLabel,
        input.hintsUsed,
        input.selfCorrections,
        JSON.stringify(input.insightResults),
        input.ratingBefore,
        input.ratingAfter,
        input.masteryBefore,
        input.masteryAfter,
        JSON.stringify(input.newlyMasteredInsights),
        JSON.stringify(input.transcript),
        JSON.stringify(input.verdict),
      ],
    );
    return toAttempt(result.rows[0]);
  }

  async getAttemptBySessionId(sessionId: string): Promise<StoredAttempt | null> {
    const result = await this.pool.query<AttemptRow>(
      `SELECT * FROM attempts WHERE session_id = $1`,
      [sessionId],
    );
    return result.rows[0] ? toAttempt(result.rows[0]) : null;
  }

  async listAttempts(userId: string): Promise<StoredAttempt[]> {
    const result = await this.pool.query<AttemptRow>(
      `SELECT * FROM attempts WHERE user_id = $1 ORDER BY completed_at DESC`,
      [userId],
    );
    return result.rows.map(toAttempt);
  }

  async insertRatingEvent(
    event: Omit<RatingEvent, "createdAt"> & { createdAt?: string },
  ): Promise<RatingEvent> {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      attempt_id: string;
      pattern: string;
      rating_before: number;
      rating_after: number;
      delta: number;
      created_at: Date | string;
    }>(
      `INSERT INTO rating_events (
         id, user_id, attempt_id, pattern, rating_before, rating_after, delta
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        event.id,
        event.userId,
        event.attemptId,
        event.pattern,
        event.ratingBefore,
        event.ratingAfter,
        event.delta,
      ],
    );
    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      attemptId: row.attempt_id,
      pattern: row.pattern,
      ratingBefore: row.rating_before,
      ratingAfter: row.rating_after,
      delta: row.delta,
      createdAt: iso(row.created_at) ?? new Date().toISOString(),
    };
  }
}
