import type { Verdict } from "@reason/core";
import VerdictCard from "./VerdictCard";
import MarkdownMessage from "./MarkdownMessage";

export type ChatMessage = { role: "USER" | "AI"; content: string };

export type ArchivedAttempt = {
  id?: string;
  problemSlug?: string;
  coreAsk: string;
  transcript: ChatMessage[];
  verdict: Verdict | null;
};

export default function AttemptHistory({
  attempts,
  onOpenProblem,
}: {
  attempts: ArchivedAttempt[];
  /** When set, attempt titles link to that problem (e.g. Profile history). */
  onOpenProblem?: (problemSlug: string) => void;
}) {
  if (attempts.length === 0) return null;

  return (
    <>
      {attempts.map((attempt, attemptIndex) => (
        <details className="attempt-history" key={attempt.id ?? attemptIndex}>
          <summary>
            {onOpenProblem && attempt.problemSlug ? (
              <button
                type="button"
                className="attempt-history-link"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenProblem(attempt.problemSlug!);
                }}
              >
                Attempt {attemptIndex + 1}: {attempt.coreAsk}
              </button>
            ) : (
              <>
                Attempt {attemptIndex + 1}: {attempt.coreAsk}
              </>
            )}
          </summary>
          <div className="attempt-history-content">
            {onOpenProblem && attempt.problemSlug && (
              <button
                type="button"
                className="btn btn-secondary attempt-open-btn"
                onClick={() => onOpenProblem(attempt.problemSlug!)}
              >
                Open this problem
              </button>
            )}
            {attempt.transcript.map((message, messageIndex) => (
              <div
                key={messageIndex}
                className={`msg ${message.role === "USER" ? "user" : "ai"}`}
              >
                {message.role === "AI" ? (
                  <MarkdownMessage content={message.content} />
                ) : (
                  message.content
                )}
              </div>
            ))}
            {attempt.verdict && <VerdictCard verdict={attempt.verdict} />}
          </div>
        </details>
      ))}
    </>
  );
}
