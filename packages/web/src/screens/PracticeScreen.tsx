import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { MAX_HINTS_PER_SESSION, searchProblems, type Verdict } from "@reason/core";
import {
  fetchAttempts,
  fetchProblems,
  revealVerdict,
  startSession,
  submitTurn,
  type Problem,
  type ProgressUpdate,
  type SessionStart,
} from "../api";
import AttemptHistory, {
  type ArchivedAttempt,
  type ChatMessage,
} from "../components/AttemptHistory";
import VerdictCard from "../components/VerdictCard";
import MarkdownMessage from "../components/MarkdownMessage";

type Screen = "start" | "loop";

const SEARCH_RESULT_LIMIT = 20;
const ASK_SNIPPET_LENGTH = 90;

function askSnippet(text: string): string {
  if (text.length <= ASK_SNIPPET_LENGTH) return text;
  return `${text.slice(0, ASK_SNIPPET_LENGTH).trimEnd()}…`;
}

export default function PracticeScreen({
  requestedSlug,
  queuedSlugs,
  onOpenRoadmap,
  onConsumedSlug,
  onShiftQueue,
}: {
  requestedSlug: string | null;
  queuedSlugs: string[];
  onOpenRoadmap: () => void;
  onConsumedSlug: () => void;
  onShiftQueue: () => void;
}) {
  const [screen, setScreen] = useState<Screen>("start");
  const [problems, setProblems] = useState<Problem[]>([]);
  const [currentProblemIndex, setCurrentProblemIndex] = useState(0);
  const [session, setSession] = useState<SessionStart | null>(null);
  const [transcript, setTranscript] = useState<ChatMessage[]>([]);
  const [archivedAttempts, setArchivedAttempts] = useState<ArchivedAttempt[]>(
    [],
  );
  const [hintsUsed, setHintsUsed] = useState(0);
  const [verdictPlacement, setVerdictPlacement] = useState<{
    verdict: Verdict;
    progress?: ProgressUpdate;
    afterMessageIndex: number;
  } | null>(null);
  const [verdictReady, setVerdictReady] = useState(false);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnCount, setTurnCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(
    async (problemSlug: string, excludeSessionId?: string) => {
      try {
        const attempts = await fetchAttempts();
        setArchivedAttempts(
          attempts
            .filter(
              (attempt) =>
                attempt.problemSlug === problemSlug &&
                attempt.sessionId !== excludeSessionId,
            )
            .map((attempt) => ({
              id: attempt.id,
              problemSlug: attempt.problemSlug,
              coreAsk: attempt.coreAsk,
              transcript: attempt.transcript,
              verdict: attempt.verdict,
            })),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load history");
      }
    },
    [],
  );

  useEffect(() => {
    fetchProblems()
      .then(setProblems)
      .catch((e) => setError(e.message));
  }, []);

  const problem = problems[currentProblemIndex];
  const searchHits = searchProblems(problems, query).slice(0, SEARCH_RESULT_LIMIT);
  const searching = query.trim().length > 0;

  const beginProblem = useCallback(async (target: Problem) => {
    setLoading(true);
    setError(null);
    try {
      const s = await startSession(target.slug);
      setSession(s);
      setTranscript([]);
      setHintsUsed(0);
      setVerdictPlacement(null);
      setVerdictReady(false);
      setTurnCount(0);
      setScreen("loop");
      await loadHistory(target.slug, s.sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setLoading(false);
    }
  }, [loadHistory]);

  useEffect(() => {
    if (!requestedSlug || problems.length === 0) return;
    const index = problems.findIndex((item) => item.slug === requestedSlug);
    if (index < 0) {
      onConsumedSlug();
      return;
    }
    setCurrentProblemIndex(index);
    void beginProblem(problems[index]);
    onConsumedSlug();
  }, [requestedSlug, problems, beginProblem, onConsumedSlug]);

  const handleStart = useCallback(() => {
    if (problem) void beginProblem(problem);
  }, [beginProblem, problem]);

  const handleSelectSearchResult = useCallback(
    (slug: string) => {
      const index = problems.findIndex((item) => item.slug === slug);
      if (index < 0) return;
      setCurrentProblemIndex(index);
      setQuery("");
    },
    [problems],
  );

  const archiveCurrent = useCallback(() => {
    if (!session || transcript.length === 0) return;
    setArchivedAttempts((attempts) => [
      {
        problemSlug: session.problemSlug,
        coreAsk: session.coreAsk,
        transcript,
        verdict: verdictPlacement?.verdict ?? null,
      },
      ...attempts,
    ]);
  }, [session, transcript, verdictPlacement]);

  const handleBack = useCallback(() => {
    const slug = session?.problemSlug ?? problem?.slug;
    archiveCurrent();
    setScreen("start");
    setSession(null);
    setTranscript([]);
    setHintsUsed(0);
    setVerdictPlacement(null);
    setVerdictReady(false);
    setTurnCount(0);
    setInput("");
    setError(null);
    if (slug) void loadHistory(slug);
  }, [archiveCurrent, loadHistory, session, problem]);

  const handleSend = useCallback(async () => {
    if (!session || !input.trim() || loading) return;
    setLoading(true);
    setError(null);
    const message = input.trim();
    setInput("");
    // Show the user bubble immediately while the grader thinks.
    setTranscript((prev) => [...prev, { role: "USER", content: message }]);

    try {
      const key = `turn-${session.sessionId}-${turnCount}`;
      const result = await submitTurn(session.sessionId, message, key);
      setTranscript(result.transcript);
      setHintsUsed(result.hintsUsed);
      setTurnCount((c) => c + 1);
      setVerdictReady(result.action.kind === "verdict_ready");

      if (result.action.kind === "verdict") {
        setVerdictPlacement({
          verdict: result.action.verdict,
          progress: result.progress,
          afterMessageIndex: result.transcript.length,
        });
        void loadHistory(session.problemSlug, session.sessionId);
      }
    } catch (e) {
      setTranscript((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "USER" && last.content === message) {
          return prev.slice(0, -1);
        }
        return prev;
      });
      setError(e instanceof Error ? e.message : "Failed to send");
      setInput(message);
    } finally {
      setLoading(false);
    }
  }, [session, input, loading, turnCount, loadHistory]);

  const handleRevealVerdict = useCallback(async () => {
    if (!session || loading) return;
    setLoading(true);
    setError(null);

    try {
      const result = await revealVerdict(
        session.sessionId,
        `verdict-${session.sessionId}-${turnCount}`,
      );
      setTranscript(result.transcript);
      setHintsUsed(result.hintsUsed);
      setTurnCount((count) => count + 1);
      setVerdictReady(false);

      if (result.action.kind === "verdict") {
        setVerdictPlacement({
          verdict: result.action.verdict,
          progress: result.progress,
          afterMessageIndex: result.transcript.length,
        });
        void loadHistory(session.problemSlug, session.sessionId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reveal verdict");
    } finally {
      setLoading(false);
    }
  }, [session, loading, turnCount, loadHistory]);

  const handleNewAttempt = useCallback(() => {
    if (!problem) return;
    archiveCurrent();
    void beginProblem(problem);
  }, [archiveCurrent, beginProblem, problem]);

  const handleNextQuestion = useCallback(async () => {
    archiveCurrent();
    const queued = queuedSlugs[0];
    if (queued) {
      onShiftQueue();
      const next = problems.find((item) => item.slug === queued);
      if (next) {
        const index = problems.findIndex((item) => item.slug === queued);
        if (index >= 0) setCurrentProblemIndex(index);
        await beginProblem(next);
        return;
      }
    }
    const recommended = verdictPlacement?.progress?.recommendedNext;
    if (recommended) {
      const index = problems.findIndex((item) => item.slug === recommended.slug);
      if (index >= 0) setCurrentProblemIndex(index);
      await beginProblem(recommended);
      return;
    }
    if (problems.length < 2) return;
    const nextIndex = (currentProblemIndex + 1) % problems.length;
    setCurrentProblemIndex(nextIndex);
    void beginProblem(problems[nextIndex]);
  }, [
    archiveCurrent,
    beginProblem,
    currentProblemIndex,
    onShiftQueue,
    problems,
    queuedSlugs,
    verdictPlacement,
  ]);

  const followUp = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  if (!problem && !error) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <>
      <header className="header">
        <button
          type="button"
          className="back-btn"
          onClick={screen === "loop" ? handleBack : onOpenRoadmap}
        >
          ‹ Back
        </button>
        {session ? (
          <span className="meta">
            {session.pattern} · {session.difficulty}
          </span>
        ) : (
          problem && (
            <span className="meta">
              {problem.pattern} · {problem.difficulty}
            </span>
          )
        )}
      </header>

      {screen === "start" && problem && (
        <>
          <div className="problem-search">
            <label className="problem-search-label" htmlFor="problem-search">
              Find a problem
            </label>
            <input
              id="problem-search"
              className="problem-search-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title or description…"
              autoComplete="off"
            />
            {searching && (
              <ul className="problem-search-results">
                {searchHits.length === 0 ? (
                  <li className="problem-search-empty">No problems match.</li>
                ) : (
                  searchHits.map((hit) => (
                    <li key={hit.slug}>
                      <button
                        type="button"
                        className="problem-search-result"
                        onClick={() => handleSelectSearchResult(hit.slug)}
                      >
                        <span className="problem-search-title">
                          {hit.title ?? hit.slug}
                        </span>
                        <span className="problem-search-ask">
                          {askSnippet(hit.coreAsk)}
                        </span>
                        <span className="meta">
                          {hit.pattern} · {hit.difficulty}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
          <div className="card">
            <span className="badge">Boss · Reasoning</span>
            {problem.title && (
              <h2 className="roadmap-pattern">{problem.title}</h2>
            )}
            <p className="core-ask">{problem.coreAsk}</p>
            <p className="meta">
              {problem.pattern} · {problem.difficulty} · ~2 min · text reply
            </p>
            <button className="btn" onClick={handleStart} disabled={loading}>
              {loading ? "Starting..." : "Start reasoning"}
            </button>
            {error && <p className="error">{error}</p>}
          </div>
        </>
      )}

      {screen === "loop" && session && (
        <div className="card">
          <p className="meta">CORE ASK</p>
          <p className="core-ask" style={{ fontSize: "0.95rem" }}>
            {session.coreAsk}
          </p>

          <section className="sample-example" aria-labelledby="sample-example-title">
            <p id="sample-example-title" className="sample-example-title">
              EXAMPLE
            </p>
            <p className="sample-example-row">
              <span>Input</span>
              <code>{session.sampleExample.input}</code>
            </p>
            <p className="sample-example-row">
              <span>Output</span>
              <code>{session.sampleExample.output}</code>
            </p>
            <p className="sample-example-explanation">
              <span>Explanation</span>
              {session.sampleExample.explanation}
            </p>
          </section>

          <div className="chat">
            <AttemptHistory attempts={archivedAttempts} />

            {transcript.map((msg, i) => (
              <Fragment key={i}>
                <div className={`msg ${msg.role === "USER" ? "user" : "ai"}`}>
                  {msg.role === "AI" ? (
                    <MarkdownMessage content={msg.content} />
                  ) : (
                    msg.content
                  )}
                </div>
                {verdictPlacement?.afterMessageIndex === i + 1 && (
                  <div
                    className={
                      verdictPlacement.verdict.label === "plausible_unverified"
                        ? "verdict-unverified"
                        : undefined
                    }
                  >
                    <VerdictCard
                      verdict={verdictPlacement.verdict}
                      progress={verdictPlacement.progress}
                      id="current-verdict"
                    />
                  </div>
                )}
              </Fragment>
            ))}
            {loading && <div className="loading">Thinking...</div>}
          </div>

          {!verdictPlacement && verdictReady && (
            <div className="verdict-choice">
              <button className="btn" onClick={handleRevealVerdict}>
                Show verdict
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setVerdictReady(false)}
              >
                Keep reasoning
              </button>
            </div>
          )}

          {!verdictPlacement && !verdictReady && turnCount >= 1 && (
            <button
              className="see-answer"
              onClick={handleRevealVerdict}
              disabled={loading}
            >
              See answer now
            </button>
          )}

          <p className="hint-counter">
            {verdictPlacement
              ? "Ask follow-up questions below · score is final"
              : hintsUsed > 0
                ? `hint ${hintsUsed} of ${MAX_HINTS_PER_SESSION} used`
                : "follow-ups don't count as hints"}
          </p>

          <div className="input-row">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder={
                verdictPlacement
                  ? "Ask about the ideal solution..."
                  : "Explain your approach..."
              }
              disabled={loading}
            />
            <button
              className="btn"
              style={{ width: "auto" }}
              onClick={handleSend}
              disabled={loading || !input.trim()}
            >
              {verdictPlacement ? "Ask" : "Send"}
            </button>
          </div>

          {verdictPlacement && (
            <div className="post-verdict-actions">
              <button type="button" onClick={followUp}>
                Follow up
              </button>
              <button
                type="button"
                className="next-question"
                onClick={() => void handleNextQuestion()}
                disabled={loading}
              >
                Next question
              </button>
              <button type="button" onClick={onOpenRoadmap}>
                Roadmap
              </button>
            </div>
          )}
          {verdictPlacement && (
            <button
              className="see-answer"
              onClick={handleNewAttempt}
              disabled={loading}
            >
              Retry this question
            </button>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </>
  );
}
