import type { Verdict } from "@reason/core";
import VerdictCard from "./VerdictCard";

export type ChatMessage = { role: "USER" | "AI"; content: string };

export type ArchivedAttempt = {
  id?: string;
  coreAsk: string;
  transcript: ChatMessage[];
  verdict: Verdict | null;
};

export default function AttemptHistory({
  attempts,
}: {
  attempts: ArchivedAttempt[];
}) {
  if (attempts.length === 0) return null;

  return (
    <>
      {attempts.map((attempt, attemptIndex) => (
        <details className="attempt-history" key={attempt.id ?? attemptIndex}>
          <summary>
            Attempt {attemptIndex + 1}: {attempt.coreAsk}
          </summary>
          <div className="attempt-history-content">
            {attempt.transcript.map((message, messageIndex) => (
              <div
                key={messageIndex}
                className={`msg ${message.role === "USER" ? "user" : "ai"}`}
              >
                {message.content}
              </div>
            ))}
            {attempt.verdict && <VerdictCard verdict={attempt.verdict} />}
          </div>
        </details>
      ))}
    </>
  );
}
