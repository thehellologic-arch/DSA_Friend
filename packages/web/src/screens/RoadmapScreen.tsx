import { useEffect, useState } from "react";
import {
  fetchRoadmap,
  type LevelAvailability,
  type Roadmap,
  type RoadmapLevel,
  type RoadmapTrackGroup,
} from "../api";

const AVAILABILITY_LABEL: Record<LevelAvailability, string> = {
  mastered: "Mastered",
  recommended: "Recommended",
  available: "Available",
  above_rating: "Above your current rating",
};

type View = "blind-75" | "pattern";
type OpenPattern = { pattern: string; level: number };

export default function RoadmapScreen({
  active,
  onPractice,
}: {
  active: boolean;
  onPractice: (slug: string) => void;
}) {
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("blind-75");
  const [openPattern, setOpenPattern] = useState<OpenPattern | null>(null);
  const [openGroup, setOpenGroup] = useState<RoadmapTrackGroup | null>(null);

  useEffect(() => {
    if (!active) return;
    fetchRoadmap()
      .then((next) => {
        setRoadmap(next);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [active]);

  const topics = roadmap?.topics ?? [];
  const track = roadmap?.tracks?.find((item) => item.id === "blind-75");
  const topic = openPattern
    ? topics.find((item) => item.pattern === openPattern.pattern)
    : undefined;
  const level: RoadmapLevel | undefined = topic?.levels.find(
    (item) => item.level === openPattern?.level,
  );

  if (openPattern && topic && level) {
    return (
      <>
        <header className="header">
          <button
            type="button"
            className="back-btn"
            onClick={() => setOpenPattern(null)}
          >
            ‹ Back
          </button>
          <span className="meta">
            {topic.pattern} · Level {level.level}
          </span>
        </header>

        <article className="roadmap-topic">
          <h1 className="screen-title">
            Level {level.level} · {level.bandLabel}
          </h1>
          <p className="meta">{AVAILABILITY_LABEL[level.availability]}</p>
          <p className="meta">
            Current rating {topic.rating} · recommended Level{" "}
            {topic.recommendedLevel}. Nothing is locked.
          </p>

          {level.problems.length === 0 ? (
            <p className="meta empty-level">
              No problems in this band yet. Pick another level, or start any
              listed problem from other levels — expert bands stay open.
            </p>
          ) : (
            <ul className="roadmap-problem-list">
              {level.problems.map((problem) => (
                <li key={problem.slug}>
                  <button
                    type="button"
                    className="roadmap-problem"
                    onClick={() => onPractice(problem.slug)}
                  >
                    {problem.title && (
                      <span className="roadmap-problem-title">{problem.title}</span>
                    )}
                    <span className="roadmap-problem-ask">{problem.coreAsk}</span>
                    <span className="meta">
                      {problem.pattern} · {problem.difficulty}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </article>
      </>
    );
  }

  if (openGroup) {
    return (
      <>
        <header className="header">
          <button
            type="button"
            className="back-btn"
            onClick={() => setOpenGroup(null)}
          >
            ‹ Back
          </button>
          <span className="meta">
            Blind 75 · {openGroup.completedCount}/{openGroup.problemCount}
          </span>
        </header>

        <article className="roadmap-topic">
          <h1 className="screen-title">{openGroup.title}</h1>
          <p className="meta">
            {openGroup.completedCount} of {openGroup.problemCount} completed
          </p>
          <ul className="roadmap-problem-list">
            {openGroup.problems.map((problem) => (
              <li key={problem.slug}>
                <button
                  type="button"
                  className="roadmap-problem"
                  onClick={() => onPractice(problem.slug)}
                >
                  <span className="roadmap-problem-title">
                    {problem.completed ? "✓ " : ""}
                    {problem.title ?? problem.slug}
                  </span>
                  <span className="roadmap-problem-ask">{problem.coreAsk}</span>
                  <span className="meta">
                    {problem.pattern} · {problem.difficulty}
                    {problem.completed ? " · completed" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </article>
      </>
    );
  }

  return (
    <>
      <header className="header">
        <h1 className="screen-title">Roadmap</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {!roadmap && !error && <p className="loading">Loading roadmap...</p>}

      <div className="roadmap-view-toggle" role="tablist" aria-label="Roadmap view">
        <button
          type="button"
          role="tab"
          aria-selected={view === "blind-75"}
          className={view === "blind-75" ? "active" : ""}
          onClick={() => setView("blind-75")}
        >
          Blind 75
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "pattern"}
          className={view === "pattern" ? "active" : ""}
          onClick={() => setView("pattern")}
        >
          By pattern
        </button>
      </div>

      {view === "blind-75" && track && (
        <article className="roadmap-topic">
          <h2 className="roadmap-pattern">{track.title}</h2>
          <p className="meta roadmap-track-intro">
            Official topic order. Premium problems included. Nothing is locked.
          </p>
          <ul className="roadmap-levels">
            {track.groups.map((group) => (
              <li key={group.id}>
                <button
                  type="button"
                  className="roadmap-level-btn"
                  onClick={() => setOpenGroup(group)}
                >
                  <span>
                    <span className="roadmap-level-title">{group.title}</span>
                    <span className="meta">
                      {group.completedCount}/{group.problemCount} completed
                    </span>
                  </span>
                  <span className="roadmap-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </article>
      )}

      {view === "pattern" &&
        topics.map((item) => (
          <article className="roadmap-topic" key={item.pattern}>
            <h2 className="roadmap-pattern">{item.pattern}</h2>
            <p className="meta">Current rating: {item.rating}</p>
            <p className="meta">Recommended: Level {item.recommendedLevel}</p>
            <ul className="roadmap-levels">
              {item.levels.map((entry) => (
                <li key={entry.level}>
                  <button
                    type="button"
                    className={`roadmap-level-btn ${entry.availability}`}
                    onClick={() =>
                      setOpenPattern({ pattern: item.pattern, level: entry.level })
                    }
                  >
                    <span>
                      <span className="roadmap-level-title">
                        Level {entry.level}{" "}
                        <span className="meta">
                          {AVAILABILITY_LABEL[entry.availability]}
                        </span>
                      </span>
                      <span className="meta">{entry.bandLabel}</span>
                      <span className="meta">
                        {entry.problems.length} problem
                        {entry.problems.length === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="roadmap-chevron" aria-hidden="true">
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </article>
        ))}
    </>
  );
}
