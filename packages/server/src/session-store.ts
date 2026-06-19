import { randomUUID } from "node:crypto";
import type {
  ClassifyResult,
  Rubric,
  SessionContext,
  SessionState,
  TurnAction,
  TurnView,
} from "@reason/core";

export interface StoredTurn {
  idx: number;
  role: "USER" | "AI";
  content: string;
  classifierOutput?: ClassifyResult;
  idempotencyKey?: string;
  actionKind?: "follow_up" | "hint" | "counterexample";
  insightId?: string;
}

export interface Session {
  id: string;
  problemSlug: string;
  rubric: Rubric;
  context: SessionContext;
  turns: StoredTurn[];
  idempotencyCache: Map<string, TurnAction>;
}

export class InMemorySessionStore {
  private sessions = new Map<string, Session>();

  create(problemSlug: string, rubric: Rubric): Session {
    const session: Session = {
      id: randomUUID(),
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
