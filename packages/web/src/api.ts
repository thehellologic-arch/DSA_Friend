import type { TurnAction } from "@reason/core";

const API = "/api";

export interface Problem {
  slug: string;
  pattern: string;
  difficulty: number;
  coreAsk: string;
}

export interface SessionStart {
  sessionId: string;
  coreAsk: string;
  pattern: string;
  difficulty: number;
  state: string;
}

export interface TurnResponse {
  action: TurnAction;
  transcript: { role: "USER" | "AI"; content: string }[];
  hintsUsed: number;
  state: string;
}

export async function fetchProblems(): Promise<Problem[]> {
  const res = await fetch(`${API}/problems`);
  if (!res.ok) throw new Error("Failed to load problems");
  const data = await res.json();
  return data.problems;
}

export async function startSession(problemSlug: string): Promise<SessionStart> {
  const res = await fetch(`${API}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ problemSlug }),
  });
  if (!res.ok) throw new Error("Failed to start session");
  return res.json();
}

export async function submitTurn(
  sessionId: string,
  message: string,
  idempotencyKey: string,
): Promise<TurnResponse> {
  const res = await fetch(`${API}/sessions/${sessionId}/turns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, idempotencyKey }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Failed to submit turn");
  }
  return res.json();
}
