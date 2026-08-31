import { useCallback, useEffect, useState } from "react";
import {
  fetchAttempts,
  fetchProgress,
  logout,
  setSkillLevel,
  type SkillLevel,
  type StoredAttempt,
  type UserProgress,
} from "../api";
import AttemptHistory from "../components/AttemptHistory";

const LEVELS: { id: SkillLevel; label: string }[] = [
  { id: "beginner", label: "Beginner" },
  { id: "intermediate", label: "Intermediate" },
  { id: "advanced", label: "Advanced" },
  { id: "expert", label: "Expert" },
];

interface Props {
  username: string;
  onLogout: () => void;
}

export default function ProfileScreen({ username, onLogout }: Props) {
  const [progress, setProgress] = useState<UserProgress | null>(null);
  const [attempts, setAttempts] = useState<StoredAttempt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [nextProgress, nextAttempts] = await Promise.all([
        fetchProgress(),
        fetchAttempts(),
      ]);
      setProgress(nextProgress);
      setAttempts(nextAttempts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load profile");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeLevel = async (level: SkillLevel) => {
    setSaving(true);
    setError(null);
    try {
      const next = await setSkillLevel(level);
      setProgress(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to change level");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Still clear local session UI.
    }
    onLogout();
  };

  if (!progress && !error) {
    return <div className="loading">Loading profile...</div>;
  }

  return (
    <>
      <header className="header">
        <h1 className="screen-title">Profile</h1>
        <span className="meta">{username}</span>
      </header>

      <section className="card profile-card">
        <h2>Account</h2>
        <p className="meta">
          Signed in as <strong>{username}</strong>
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void handleLogout()}
        >
          Log out
        </button>
      </section>

      <section className="card profile-card">
        <h2>Skill level</h2>
        <p className="meta">
          Changing level reseeds topics you have not started. Practiced topics
          keep their rating.
        </p>
        <fieldset className="level-fieldset">
          <legend>Change level</legend>
          <div className="level-row">
            {LEVELS.map((level) => (
              <button
                key={level.id}
                type="button"
                className={
                  progress?.skillLevel === level.id ? "btn" : "btn btn-secondary"
                }
                disabled={saving}
                onClick={() => void changeLevel(level.id)}
              >
                {level.label}
              </button>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="card profile-card">
        <h2>Skill by pattern</h2>
        {progress?.topics.map((topic) => (
          <div className="skill-row" key={topic.pattern}>
            <div className="skill-row-header">
              <strong>{topic.pattern}</strong>
              <span className="meta">
                {topic.rating} · {topic.status.replaceAll("_", " ")}
              </span>
            </div>
            <div
              className="mastery-bar"
              role="progressbar"
              aria-valuenow={topic.masteryPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${topic.pattern} mastery ${topic.masteryPercent} percent`}
            >
              <span style={{ width: `${topic.masteryPercent}%` }} />
            </div>
            <p className="meta">
              Mastery {topic.masteryPercent}% · {topic.problemsCompleted}{" "}
              completed · {topic.hintUsage} hints
              {topic.lastPracticedAt
                ? ` · last practiced ${new Date(topic.lastPracticedAt).toLocaleDateString()}`
                : ""}
            </p>
          </div>
        ))}
      </section>

      <section className="card profile-card">
        <h2>History</h2>
        {attempts.length === 0 ? (
          <p className="meta">No attempts yet.</p>
        ) : (
          <AttemptHistory
            attempts={attempts.map((attempt) => ({
              id: attempt.id,
              coreAsk: attempt.coreAsk,
              transcript: attempt.transcript,
              verdict: attempt.verdict,
            }))}
          />
        )}
      </section>
      {error && <p className="error">{error}</p>}
    </>
  );
}
