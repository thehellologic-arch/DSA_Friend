import { useState } from "react";
import { fetchProblems, setSkillLevel, type SkillLevel } from "../api";

const LEVELS: { id: SkillLevel; label: string; hint: string }[] = [
  { id: "beginner", label: "Beginner", hint: "Start around 800" },
  { id: "intermediate", label: "Intermediate", hint: "Start around 1100" },
  { id: "advanced", label: "Advanced", hint: "Start around 1400" },
  { id: "expert", label: "Expert", hint: "Start around 1700" },
];

export default function OnboardingScreen({
  onDone,
}: {
  onDone: (placementSlugs?: string[]) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SkillLevel>("intermediate");

  const finish = async (level: SkillLevel, takePlacement: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await setSkillLevel(level);
      if (!takePlacement) {
        onDone();
        return;
      }
      const problems = await fetchProblems();
      const ranked = [...problems].sort((a, b) => {
        const target =
          level === "beginner"
            ? 800
            : level === "intermediate"
              ? 1100
              : level === "advanced"
                ? 1400
                : 1700;
        return Math.abs(a.difficulty - target) - Math.abs(b.difficulty - target);
      });
      onDone(ranked.slice(0, 2).map((problem) => problem.slug));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save level");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card onboarding-card">
      <h1 className="screen-title">Welcome to CoderBhaiya</h1>
      <p className="meta">
        Continue as a guest. Nothing is locked — pick a starting level, or skip
        straight into practice.
      </p>

      <fieldset className="level-fieldset">
        <legend>Choose your level</legend>
        <div className="level-grid">
          {LEVELS.map((level) => (
            <button
              key={level.id}
              type="button"
              className={selected === level.id ? "btn" : "btn btn-secondary"}
              onClick={() => setSelected(level.id)}
              disabled={saving}
            >
              {level.label}
              <span className="level-hint">{level.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <button
        className="btn"
        disabled={saving}
        onClick={() => void finish(selected, false)}
      >
        {saving ? "Saving..." : "Continue as guest"}
      </button>
      <button
        className="btn btn-secondary"
        disabled={saving}
        onClick={() => void finish(selected, true)}
      >
        Take a short placement
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
