CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  skill_level TEXT NOT NULL DEFAULT 'intermediate',
  onboarded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS topic_progress (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  rating INTEGER NOT NULL,
  mastery_percent INTEGER NOT NULL DEFAULT 0,
  problems_completed INTEGER NOT NULL DEFAULT 0,
  hint_usage INTEGER NOT NULL DEFAULT 0,
  last_practiced_at TIMESTAMPTZ,
  recent_performance JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (user_id, pattern)
);

CREATE TABLE IF NOT EXISTS attempts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  problem_slug TEXT NOT NULL,
  pattern TEXT NOT NULL,
  difficulty INTEGER NOT NULL,
  core_ask TEXT NOT NULL,
  score INTEGER NOT NULL,
  verdict_label TEXT NOT NULL,
  hints_used INTEGER NOT NULL,
  self_corrections INTEGER NOT NULL DEFAULT 0,
  insight_results JSONB NOT NULL,
  rating_before INTEGER NOT NULL,
  rating_after INTEGER NOT NULL,
  mastery_before INTEGER NOT NULL,
  mastery_after INTEGER NOT NULL,
  newly_mastered_insights JSONB NOT NULL DEFAULT '[]'::jsonb,
  transcript JSONB NOT NULL,
  verdict JSONB NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS attempts_session_id_idx ON attempts (session_id);
CREATE INDEX IF NOT EXISTS attempts_user_completed_idx
  ON attempts (user_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS rating_events (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempt_id UUID NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  rating_before INTEGER NOT NULL,
  rating_after INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
