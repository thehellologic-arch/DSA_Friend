import type { TopicProgress, TurnAction, Verdict } from "@reason/core";

const API = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Request failed: ${path}`);
  }
  return res.json() as Promise<T>;
}

export type SkillLevel = "beginner" | "intermediate" | "advanced" | "expert";

export interface Problem {
  slug: string;
  pattern: string;
  difficulty: number;
  coreAsk: string;
  title?: string;
  topic?: string;
  completed?: boolean;
}

export interface SessionStart {
  sessionId: string;
  coreAsk: string;
  title?: string;
  topic?: string;
  pattern: string;
  difficulty: number;
  sampleExample: {
    input: string;
    output: string;
    explanation: string;
  };
  state: string;
}

export interface ProgressUpdate {
  pattern: string;
  ratingBefore: number;
  ratingAfter: number;
  masteryBefore: number;
  masteryAfter: number;
  newlyMasteredInsights: Verdict["insights"];
  recommendedNext: Problem | null;
  ratingEligible: boolean;
  ratingDelta: number;
  validationStatus: Verdict["label"];
  validationEvidence: string[];
}

export interface TurnResponse {
  action: TurnAction;
  transcript: { role: "USER" | "AI"; content: string }[];
  hintsUsed: number;
  state: string;
  progress?: ProgressUpdate;
}

export interface UserProgress {
  userId: string;
  skillLevel: SkillLevel;
  onboarded: boolean;
  topics: TopicProgress[];
}

export interface AuthUser {
  userId: string;
  username: string;
  onboarded: boolean;
  skillLevel: SkillLevel;
}

export type LevelAvailability =
  | "mastered"
  | "recommended"
  | "available"
  | "above_rating";

export interface RoadmapLevel {
  level: number;
  bandLabel: string;
  availability: LevelAvailability;
  problems: Problem[];
}

export interface RoadmapTopic extends TopicProgress {
  recommendedLevel: number;
  levels: RoadmapLevel[];
}

export interface RoadmapTrackGroup {
  id: string;
  title: string;
  completedCount: number;
  problemCount: number;
  problems: Problem[];
}

export interface RoadmapTrack {
  id: string;
  title: string;
  groups: RoadmapTrackGroup[];
}

export interface Roadmap {
  skillLevel: SkillLevel;
  tracks: RoadmapTrack[];
  topics: RoadmapTopic[];
}

export interface StoredAttempt {
  id: string;
  sessionId: string;
  problemSlug: string;
  pattern: string;
  difficulty: number;
  coreAsk: string;
  score: number;
  verdictLabel: Verdict["label"];
  hintsUsed: number;
  transcript: { role: "USER" | "AI"; content: string }[];
  verdict: Verdict;
  completedAt: string;
  ratingBefore: number;
  ratingAfter: number;
  masteryBefore: number;
  masteryAfter: number;
}

export async function fetchMe(): Promise<AuthUser> {
  return request("/auth/me");
}

export async function register(
  username: string,
  password: string,
): Promise<AuthUser> {
  return request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function login(
  username: string,
  password: string,
): Promise<AuthUser> {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function logout(): Promise<void> {
  await request("/auth/logout", { method: "POST" });
}

export async function fetchProblems(filters?: {
  pattern?: string;
  difficulty?: number;
}): Promise<Problem[]> {
  const params = new URLSearchParams();
  if (filters?.pattern) params.set("pattern", filters.pattern);
  if (filters?.difficulty != null) {
    params.set("difficulty", String(filters.difficulty));
  }
  const qs = params.toString();
  const data = await request<{ problems: Problem[] }>(
    `/problems${qs ? `?${qs}` : ""}`,
  );
  return data.problems;
}

export async function fetchProgress(): Promise<UserProgress> {
  return request("/me/progress");
}

export async function fetchRoadmap(): Promise<Roadmap> {
  return request("/me/roadmap");
}

export async function fetchAttempts(): Promise<StoredAttempt[]> {
  const data = await request<{ attempts: StoredAttempt[] }>("/me/attempts");
  return data.attempts;
}

export async function fetchRecommended(filters?: {
  pattern?: string;
  difficulty?: number;
}): Promise<Problem[]> {
  const params = new URLSearchParams();
  if (filters?.pattern) params.set("pattern", filters.pattern);
  if (filters?.difficulty != null) {
    params.set("difficulty", String(filters.difficulty));
  }
  const qs = params.toString();
  const data = await request<{ problems: Problem[] }>(
    `/me/recommend${qs ? `?${qs}` : ""}`,
  );
  return data.problems;
}

export async function setSkillLevel(skillLevel: SkillLevel): Promise<UserProgress> {
  return request("/me/skill-level", {
    method: "POST",
    body: JSON.stringify({ skillLevel }),
  });
}

export async function startSession(problemSlug: string): Promise<SessionStart> {
  return request("/sessions", {
    method: "POST",
    body: JSON.stringify({ problemSlug }),
  });
}

export async function submitTurn(
  sessionId: string,
  message: string,
  idempotencyKey: string,
): Promise<TurnResponse> {
  return request(`/sessions/${sessionId}/turns`, {
    method: "POST",
    body: JSON.stringify({ message, idempotencyKey }),
  });
}

export async function revealVerdict(
  sessionId: string,
  idempotencyKey: string,
): Promise<TurnResponse> {
  return request(`/sessions/${sessionId}/verdict`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey }),
  });
}
