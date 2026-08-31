import type { SkillLevel, Verdict } from "@reason/core";
import type { Collection, Db } from "mongodb";
import { getDb } from "./mongo.js";
import type {
  CreateAttemptInput,
  ProgressRepository,
  RatingEvent,
  StoredAttempt,
  TopicProgressRow,
  UserRecord,
} from "./progress-repository.js";

interface TopicEmbedded {
  pattern: string;
  rating: number;
  masteryPercent: number;
  problemsCompleted: number;
  hintUsage: number;
  lastPracticedAt: string | null;
  recentPerformance: number[];
  masteredInsightKeys: string[];
}

interface UserDoc {
  _id: string;
  username?: string;
  usernameNormalized?: string;
  passwordHash?: string;
  skillLevel: SkillLevel;
  onboarded: boolean;
  createdAt: Date;
  completedProblemIds: string[];
  topics: TopicEmbedded[];
}

interface AttemptDoc {
  _id: string;
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
  completedAt: Date;
}

function users(db: Db): Collection<UserDoc> {
  return db.collection<UserDoc>("users");
}

function attempts(db: Db): Collection<AttemptDoc> {
  return db.collection<AttemptDoc>("attempts");
}

function toUser(doc: UserDoc): UserRecord {
  return {
    id: doc._id,
    username: doc.username,
    skillLevel: doc.skillLevel,
    onboarded: doc.onboarded,
    createdAt: doc.createdAt.toISOString(),
  };
}

function toTopic(userId: string, topic: TopicEmbedded): TopicProgressRow {
  return {
    userId,
    pattern: topic.pattern,
    rating: topic.rating,
    masteryPercent: topic.masteryPercent,
    problemsCompleted: topic.problemsCompleted,
    hintUsage: topic.hintUsage,
    lastPracticedAt: topic.lastPracticedAt,
    recentPerformance: topic.recentPerformance,
    masteredInsightKeys: topic.masteredInsightKeys ?? [],
  };
}

function toAttempt(doc: AttemptDoc): StoredAttempt {
  return {
    id: doc._id,
    userId: doc.userId,
    sessionId: doc.sessionId,
    problemSlug: doc.problemSlug,
    pattern: doc.pattern,
    difficulty: doc.difficulty,
    coreAsk: doc.coreAsk,
    score: doc.score,
    verdictLabel: doc.verdictLabel,
    hintsUsed: doc.hintsUsed,
    selfCorrections: doc.selfCorrections,
    insightResults: doc.insightResults,
    ratingBefore: doc.ratingBefore,
    ratingAfter: doc.ratingAfter,
    masteryBefore: doc.masteryBefore,
    masteryAfter: doc.masteryAfter,
    newlyMasteredInsights: doc.newlyMasteredInsights,
    transcript: doc.transcript,
    verdict: doc.verdict,
    completedAt: doc.completedAt.toISOString(),
  };
}

export async function ensureProgressIndexes(): Promise<void> {
  const db = await getDb();
  await attempts(db).createIndexes([
    { key: { sessionId: 1 }, unique: true },
    { key: { userId: 1, completedAt: -1 } },
    { key: { userId: 1, pattern: 1, completedAt: -1 } },
  ]);
}

export class MongoProgressRepository implements ProgressRepository {
  constructor(private db: Db) {}

  async createUser(
    id: string,
    _skillLevel: SkillLevel,
    _onboarded = false,
  ): Promise<UserRecord> {
    const existing = await users(this.db).findOne({ _id: id });
    if (existing) return toUser(existing);
    throw new Error("User must register before progress can be created");
  }

  async getUser(id: string): Promise<UserRecord | null> {
    const doc = await users(this.db).findOne({ _id: id });
    return doc ? toUser(doc) : null;
  }

  async setSkillLevel(id: string, skillLevel: SkillLevel): Promise<UserRecord> {
    const result = await users(this.db).findOneAndUpdate(
      { _id: id },
      { $set: { skillLevel } },
      { returnDocument: "after" },
    );
    if (!result) throw new Error("User not found");
    return toUser(result);
  }

  async markOnboarded(id: string): Promise<UserRecord> {
    const result = await users(this.db).findOneAndUpdate(
      { _id: id },
      { $set: { onboarded: true } },
      { returnDocument: "after" },
    );
    if (!result) throw new Error("User not found");
    return toUser(result);
  }

  async listTopicProgress(userId: string): Promise<TopicProgressRow[]> {
    const doc = await users(this.db).findOne({ _id: userId });
    if (!doc) return [];
    return doc.topics.map((topic) => toTopic(userId, topic));
  }

  async getTopicProgress(
    userId: string,
    pattern: string,
  ): Promise<TopicProgressRow | null> {
    const doc = await users(this.db).findOne({ _id: userId });
    const topic = doc?.topics.find((item) => item.pattern === pattern);
    return topic ? toTopic(userId, topic) : null;
  }

  async upsertTopicProgress(row: TopicProgressRow): Promise<TopicProgressRow> {
    const embedded: TopicEmbedded = {
      pattern: row.pattern,
      rating: row.rating,
      masteryPercent: row.masteryPercent,
      problemsCompleted: row.problemsCompleted,
      hintUsage: row.hintUsage,
      lastPracticedAt: row.lastPracticedAt,
      recentPerformance: row.recentPerformance,
      masteredInsightKeys: row.masteredInsightKeys ?? [],
    };
    const user = await users(this.db).findOne({ _id: row.userId });
    if (!user) throw new Error("User not found");
    const idx = user.topics.findIndex((t) => t.pattern === row.pattern);
    if (idx === -1) {
      await users(this.db).updateOne(
        { _id: row.userId },
        { $push: { topics: embedded } },
      );
    } else {
      await users(this.db).updateOne(
        { _id: row.userId },
        { $set: { [`topics.${idx}`]: embedded } },
      );
    }
    return { ...row, masteredInsightKeys: embedded.masteredInsightKeys };
  }

  async insertAttempt(input: CreateAttemptInput): Promise<StoredAttempt> {
    const doc: AttemptDoc = {
      _id: input.id,
      userId: input.userId,
      sessionId: input.sessionId,
      problemSlug: input.problemSlug,
      pattern: input.pattern,
      difficulty: input.difficulty,
      coreAsk: input.coreAsk,
      score: input.score,
      verdictLabel: input.verdictLabel,
      hintsUsed: input.hintsUsed,
      selfCorrections: input.selfCorrections,
      insightResults: input.insightResults,
      ratingBefore: input.ratingBefore,
      ratingAfter: input.ratingAfter,
      masteryBefore: input.masteryBefore,
      masteryAfter: input.masteryAfter,
      newlyMasteredInsights: input.newlyMasteredInsights,
      transcript: input.transcript,
      verdict: input.verdict,
      completedAt: new Date(),
    };
    try {
      await attempts(this.db).insertOne(doc);
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as { code: number }).code
          : undefined;
      if (code === 11000) {
        const existing = await this.getAttemptBySessionId(input.sessionId);
        if (existing) return existing;
      }
      throw err;
    }
    if (input.verdictLabel !== "plausible_unverified") {
      await users(this.db).updateOne(
        { _id: input.userId },
        { $addToSet: { completedProblemIds: input.problemSlug } },
      );
    }
    return toAttempt(doc);
  }

  async getAttemptBySessionId(sessionId: string): Promise<StoredAttempt | null> {
    const doc = await attempts(this.db).findOne({ sessionId });
    return doc ? toAttempt(doc) : null;
  }

  async listAttempts(userId: string): Promise<StoredAttempt[]> {
    const docs = await attempts(this.db)
      .find({ userId })
      .sort({ completedAt: -1 })
      .toArray();
    return docs.map(toAttempt);
  }

  async listCompletedProblemSlugs(userId: string): Promise<string[]> {
    const doc = await users(this.db).findOne(
      { _id: userId },
      { projection: { completedProblemIds: 1 } },
    );
    return doc?.completedProblemIds ?? [];
  }

  async insertRatingEvent(
    event: Omit<RatingEvent, "createdAt"> & { createdAt?: string },
  ): Promise<RatingEvent> {
    // Rating deltas live on attempts; keep interface compatibility.
    return {
      ...event,
      createdAt: event.createdAt ?? new Date().toISOString(),
    };
  }
}

export async function createMongoProgressRepository(): Promise<MongoProgressRepository> {
  const db = await getDb();
  await ensureProgressIndexes();
  return new MongoProgressRepository(db);
}
