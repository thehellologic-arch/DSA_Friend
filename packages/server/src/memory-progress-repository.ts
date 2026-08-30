import type { SkillLevel } from "@reason/core";
import type {
  CreateAttemptInput,
  ProgressRepository,
  RatingEvent,
  StoredAttempt,
  TopicProgressRow,
  UserRecord,
} from "./progress-repository.js";

export class MemoryProgressRepository implements ProgressRepository {
  users = new Map<string, UserRecord>();
  topics = new Map<string, TopicProgressRow>();
  attempts: StoredAttempt[] = [];
  events: RatingEvent[] = [];

  async createUser(
    id: string,
    skillLevel: SkillLevel,
    onboarded = false,
  ): Promise<UserRecord> {
    const existing = this.users.get(id);
    if (existing) return existing;
    const user: UserRecord = {
      id,
      skillLevel,
      onboarded,
      createdAt: new Date().toISOString(),
    };
    this.users.set(id, user);
    return user;
  }

  async getUser(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async setSkillLevel(id: string, skillLevel: SkillLevel): Promise<UserRecord> {
    const existing = this.users.get(id);
    if (!existing) throw new Error("User not found");
    const user = { ...existing, skillLevel };
    this.users.set(id, user);
    return user;
  }

  async markOnboarded(id: string): Promise<UserRecord> {
    const existing = this.users.get(id);
    if (!existing) throw new Error("User not found");
    const user = { ...existing, onboarded: true };
    this.users.set(id, user);
    return user;
  }

  async listTopicProgress(userId: string): Promise<TopicProgressRow[]> {
    return [...this.topics.values()].filter((row) => row.userId === userId);
  }

  async getTopicProgress(
    userId: string,
    pattern: string,
  ): Promise<TopicProgressRow | null> {
    return this.topics.get(`${userId}:${pattern}`) ?? null;
  }

  async upsertTopicProgress(row: TopicProgressRow): Promise<TopicProgressRow> {
    this.topics.set(`${row.userId}:${row.pattern}`, row);
    return row;
  }

  async insertAttempt(input: CreateAttemptInput): Promise<StoredAttempt> {
    const stored: StoredAttempt = {
      ...input,
      completedAt: new Date().toISOString(),
    };
    this.attempts.unshift(stored);
    return stored;
  }

  async getAttemptBySessionId(sessionId: string): Promise<StoredAttempt | null> {
    return this.attempts.find((attempt) => attempt.sessionId === sessionId) ?? null;
  }

  async listAttempts(userId: string): Promise<StoredAttempt[]> {
    return this.attempts.filter((attempt) => attempt.userId === userId);
  }

  async insertRatingEvent(
    event: Omit<RatingEvent, "createdAt"> & { createdAt?: string },
  ): Promise<RatingEvent> {
    const stored: RatingEvent = {
      ...event,
      createdAt: event.createdAt ?? new Date().toISOString(),
    };
    this.events.push(stored);
    return stored;
  }
}
