import { randomUUID } from "node:crypto";
import type {
  ClassifyResult,
  Rubric,
  SessionContext,
  SessionState,
  TurnAction,
  TurnView,
} from "@reason/core";
import type { Collection, Db } from "mongodb";
import type { ProgressUpdate } from "./progress-service.js";
import { getDb } from "./mongo.js";

export interface StoredTurn {
  idx: number;
  role: "USER" | "AI";
  content: string;
  classifierOutput?: ClassifyResult;
  idempotencyKey?: string;
  actionKind?: "follow_up" | "hint" | "counterexample" | "novel_challenge";
  insightId?: string;
}

export interface Session {
  id: string;
  userId: string;
  problemSlug: string;
  rubric: Rubric;
  context: SessionContext;
  turns: StoredTurn[];
  idempotencyCache: Map<string, TurnAction>;
  progressUpdate?: ProgressUpdate;
}

interface SessionDoc {
  _id: string;
  userId: string;
  problemSlug: string;
  rubricVersion: number;
  rubric: Rubric;
  context: SessionContext;
  turns: StoredTurn[];
  idempotencyCache: Record<string, TurnAction>;
  progressUpdate?: ProgressUpdate;
  startedAt: Date;
  updatedAt: Date;
  endedAt: Date | null;
}

export interface SessionStore {
  create(problemSlug: string, rubric: Rubric, userId: string): Promise<Session> | Session;
  get(id: string): Promise<Session | undefined> | Session | undefined;
  save(session: Session): Promise<void> | void;
}

function toSession(doc: SessionDoc): Session {
  return {
    id: doc._id,
    userId: doc.userId,
    problemSlug: doc.problemSlug,
    rubric: doc.rubric,
    context: doc.context,
    turns: doc.turns,
    idempotencyCache: new Map(Object.entries(doc.idempotencyCache ?? {})),
    progressUpdate: doc.progressUpdate,
  };
}

function toDoc(session: Session): SessionDoc {
  const now = new Date();
  return {
    _id: session.id,
    userId: session.userId,
    problemSlug: session.problemSlug,
    rubricVersion: session.rubric.rubric_version,
    rubric: session.rubric,
    context: session.context,
    turns: session.turns,
    idempotencyCache: Object.fromEntries(session.idempotencyCache),
    progressUpdate: session.progressUpdate,
    startedAt: now,
    updatedAt: now,
    endedAt: session.context.state === "VERDICT" ? now : null,
  };
}

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();

  create(problemSlug: string, rubric: Rubric, userId: string): Session {
    const session: Session = {
      id: randomUUID(),
      userId,
      problemSlug,
      rubric,
      context: {
        state: "AWAIT_APPROACH",
        insightResults: rubric.required_insights.map((i) => ({
          id: i.id,
          status: "no",
          evidence: null,
        })),
        hintsUsed: 0,
        hintsUsedByInsight: {},
        probesUsedByInsight: {},
        selfCorrections: 0,
        hadWrongApproach: false,
        lastAcceptableAlternative: null,
        approachModel: null,
        novelChallengeUsed: false,
        pendingNovelChallenge: null,
      },
      turns: [],
      idempotencyCache: new Map(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  save(_session: Session): void {
    // In-memory sessions are mutated in place.
  }
}

export class MongoSessionStore implements SessionStore {
  constructor(private db: Db) {}

  private col(): Collection<SessionDoc> {
    return this.db.collection<SessionDoc>("sessions");
  }

  async create(
    problemSlug: string,
    rubric: Rubric,
    userId: string,
  ): Promise<Session> {
    const session = new InMemorySessionStore().create(
      problemSlug,
      rubric,
      userId,
    );
    const doc = toDoc(session);
    doc.startedAt = new Date();
    doc.updatedAt = doc.startedAt;
    doc.endedAt = null;
    await this.col().insertOne(doc);
    return session;
  }

  async get(id: string): Promise<Session | undefined> {
    const doc = await this.col().findOne({ _id: id });
    return doc ? toSession(doc) : undefined;
  }

  async save(session: Session): Promise<void> {
    const doc = toDoc(session);
    await this.col().updateOne(
      { _id: session.id },
      {
        $set: {
          context: doc.context,
          turns: doc.turns,
          idempotencyCache: doc.idempotencyCache,
          progressUpdate: doc.progressUpdate,
          updatedAt: new Date(),
          endedAt: doc.endedAt,
        },
      },
    );
  }
}

export async function createSessionStore(): Promise<SessionStore> {
  if (!process.env.MONGODB_URI?.trim()) {
    return new InMemorySessionStore();
  }
  try {
    const db = await getDb();
    await db.collection("sessions").createIndexes([
      { key: { userId: 1, updatedAt: -1 } },
    ]);
    console.info("Using MongoDB session store");
    return new MongoSessionStore(db);
  } catch (err) {
    console.warn(
      "MongoDB sessions unavailable; using in-memory session store",
      err instanceof Error ? err.message : err,
    );
    return new InMemorySessionStore();
  }
}

export function getTranscript(session: Session): TurnView[] {
  return session.turns.map((t) => ({ role: t.role, content: t.content }));
}

export function updateSessionState(
  session: Session,
  state: SessionState,
): void {
  session.context.state = state;
}
