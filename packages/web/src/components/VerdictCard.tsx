import type { Verdict } from "@reason/core";
import type { ProgressUpdate } from "../api";

function verdictLabel(verdict: Verdict): string {
  const labels = {
    optimal: "Optimal reached",
    acceptable: "Acceptable approach",
    buggy: "Approach has a bug",
    incomplete: "Incomplete reasoning",
  };
  return labels[verdict.label];
}

function formatDelta(before: number, after: number): string {
  const delta = after - before;
  const sign = delta > 0 ? "+" : "";
  return `${before} → ${after} (${sign}${delta})`;
}

export default function VerdictCard({
  verdict,
  progress,
  id,
}: {
  verdict: Verdict;
  progress?: ProgressUpdate | null;
  id?: string;
}) {
  return (
    <div className="verdict-card" id={id}>
      <p className="meta verdict-kicker">VERDICT</p>
      <h2 className="verdict-title">{verdictLabel(verdict)}</h2>
      <p className="score">{verdict.score} / 100</p>

      {progress && (
        <div className="progress-delta">
          <p className="meta">
            Rating {progress.pattern} {formatDelta(progress.ratingBefore, progress.ratingAfter)}
          </p>
          <p className="meta">
            Mastery {formatDelta(progress.masteryBefore, progress.masteryAfter)}%
          </p>
          {progress.newlyMasteredInsights.length > 0 && (
            <p className="meta newly-mastered">
              Newly mastered:{" "}
              {progress.newlyMasteredInsights.map((insight) => insight.desc).join(", ")}
            </p>
          )}
          {progress.recommendedNext && (
            <p className="meta">
              Recommended next: {progress.recommendedNext.coreAsk}
            </p>
          )}
        </div>
      )}

      <p className="meta">Insights</p>
      <ul className="insights">
        {verdict.insights.map((insight) => (
          <li key={insight.id} className={insight.status}>
            {insight.desc}
          </li>
        ))}
      </ul>

      {verdict.hintsUsed > 0 && (
        <p className="meta">
          −{verdict.hintsUsed * 10} used {verdict.hintsUsed} hint
          {verdict.hintsUsed > 1 ? "s" : ""}
        </p>
      )}

      <div className="suggestion">Next: {verdict.suggestion}</div>

      <section className="ideal-solution">
        <p className="meta">IDEAL SOLUTION</p>
        <p>{verdict.idealSolution.approach}</p>
        <p className="solution-insight">
          <strong>Why:</strong> {verdict.idealSolution.keyInsight}
        </p>
        <p className="solution-complexity">
          <strong>Complexity:</strong>{" "}
          {verdict.idealSolution.complexity.time} time ·{" "}
          {verdict.idealSolution.complexity.space} space
        </p>

        {verdict.idealSolution.examples.length > 0 && (
          <div className="solution-examples">
            <p className="meta">EXAMPLES</p>
            {verdict.idealSolution.examples.map((example, i) => (
              <div className="solution-example" key={i}>
                <code>Input: {example.input}</code>
                <code>Output: {example.output}</code>
                <p>{example.explanation}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {verdict.exchanges.length > 0 && (
        <>
          <p className="meta">Follow-up review</p>
          <div className="exchanges">
            {verdict.exchanges.map((exchange, i) => (
              <div key={i} className="exchange">
                <p className="exchange-q">
                  <span className="exchange-tag">
                    {exchange.kind === "counterexample"
                      ? "Stress test"
                      : exchange.kind === "hint"
                        ? "Hint"
                        : "Follow-up"}
                  </span>
                  {exchange.question}
                </p>
                <p className="exchange-a">
                  <strong>You:</strong> {exchange.userAnswer}
                </p>
                <p className="exchange-ideal">
                  <strong>Ideal:</strong> {exchange.idealAnswer}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
