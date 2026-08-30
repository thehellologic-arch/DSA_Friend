import { useEffect, useState } from "react";
import {
  fetchRoadmap,
  type LevelAvailability,
  type RoadmapLevel,
  type RoadmapTopic,
} from "../api";

const AVAILABILITY_LABEL: Record<LevelAvailability, string> = {
  mastered: "Mastered",
  recommended: "Recommended",
  available: "Available",
  above_rating: "Above your current rating",
};

type OpenLevel = { pattern: string; level: number };

export default function RoadmapScreen({
  active,
  onPractice,
}: {
  active: boolean;
  onPractice: (slug: string) => void;
}) {
  const [topics, setTopics] = useState<RoadmapTopic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenLevel | null>(null);

  useEffect(() => {
    if (!active) return;
    fetchRoadmap()
      .then((roadmap) => setTopics(roadmap.topics))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [active]);

  const topic = open
    ? topics.find((item) => item.pattern === open.pattern)
    : undefined;
  const level: RoadmapLevel | undefined = topic?.levels.find(
    (item) => item.level === open?.level,
  );

  if (open && topic && level) {
    return (
      <>
        <header className="header">
          <button type="button" className="back-btn" onClick={() => setOpen(null)}>
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

  return (
    <>
      <header className="header">
        <h1 className="screen-title">Roadmap</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {topics.length === 0 && !error && (
        <p className="loading">Loading roadmap...</p>
      )}
      {topics.map((item) => (
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
                    setOpen({ pattern: item.pattern, level: entry.level })
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
