import { useCallback, useEffect, useState } from "react";
import type { TurnAction } from "@reason/core";
import {
  fetchProblems,
  startSession,
  submitTurn,
  type Problem,
  type SessionStart,
} from "./api";

type Screen = "start" | "loop" | "verdict";

function verdictLabel(action: TurnAction): string {
  if (action.kind !== "verdict") return "";
  const labels = {
    optimal: "Optimal reached",
    acceptable: "Acceptable approach",
    buggy: "Approach has a bug",
    incomplete: "Incomplete reasoning",
  };
  return labels[action.verdict.label];
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("start");
  const [problems, setProblems] = useState<Problem[]>([]);
  const [session, setSession] = useState<SessionStart | null>(null);
  const [transcript, setTranscript] = useState<
    { role: "USER" | "AI"; content: string }[]
  >([]);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [lastAction, setLastAction] = useState<TurnAction | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnCount, setTurnCount] = useState(0);

  useEffect(() => {
    fetchProblems()
      .then(setProblems)
      .catch((e) => setError(e.message));
  }, []);

  const problem = problems[0];

  const handleStart = useCallback(async () => {
    if (!problem) return;
    setLoading(true);
    setError(null);
    try {
      const s = await startSession(problem.slug);
      setSession(s);
      setTranscript([]);
      setHintsUsed(0);
      setLastAction(null);
      setTurnCount(0);
      setScreen("loop");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setLoading(false);
    }
  }, [problem]);

  const handleSend = useCallback(async () => {
    if (!session || !input.trim() || loading) return;
    setLoading(true);
    setError(null);
    const message = input.trim();
    setInput("");

    try {
      const key = `turn-${session.sessionId}-${turnCount}`;
      const result = await submitTurn(session.sessionId, message, key);
      setTranscript(result.transcript);
      setHintsUsed(result.hintsUsed);
      setLastAction(result.action);
      setTurnCount((c) => c + 1);

      if (result.action.kind === "verdict") {
        setScreen("verdict");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
      setInput(message);
    } finally {
      setLoading(false);
    }
  }, [session, input, loading, turnCount]);

  const handleReset = () => {
    setScreen("start");
    setSession(null);
    setTranscript([]);
    setLastAction(null);
    setHintsUsed(0);
    setError(null);
  };

  if (!problem && !error) {
    return (
      <div className="app">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <span className="badge">Reason</span>
        {session && (
          <span className="meta">
            {session.pattern} · {session.difficulty}
          </span>
        )}
      </header>

      {screen === "start" && problem && (
        <div className="card">
          <span className="badge">Boss · Reasoning</span>
          <p className="core-ask">{problem.coreAsk}</p>
          <p className="meta">~2 min · text reply</p>
          <button
            className="btn"
            onClick={handleStart}
            disabled={loading}
          >
            {loading ? "Starting..." : "Start reasoning"}
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {screen === "loop" && session && (
        <div className="card">
          <p className="meta">CORE ASK</p>
          <p className="core-ask" style={{ fontSize: "0.95rem" }}>
            {session.coreAsk}
          </p>

          <div className="chat">
            {transcript.map((msg, i) => (
              <div
                key={i}
                className={`msg ${msg.role === "USER" ? "user" : "ai"}`}
              >
                {msg.content}
              </div>
            ))}
            {loading && <div className="loading">Thinking...</div>}
          </div>

          <p className="hint-counter">
            {hintsUsed > 0
              ? `hint ${hintsUsed} of 3 used`
              : "follow-ups don't count as hints"}
          </p>

          <div className="input-row">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Explain your approach..."
              disabled={loading}
            />
            <button
              className="btn"
              style={{ width: "auto" }}
              onClick={handleSend}
              disabled={loading || !input.trim()}
            >
              Send
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {screen === "verdict" && lastAction?.kind === "verdict" && (
        <div className="card">
          <p className="meta" style={{ textAlign: "center" }}>
            VERDICT
          </p>
          <h2 className="verdict-title">{verdictLabel(lastAction)}</h2>
          <p className="score">{lastAction.verdict.score} / 100</p>

          <p className="meta">Insights</p>
          <ul className="insights">
            {lastAction.verdict.insights.map((ins) => (
              <li key={ins.id} className={ins.status}>
                {ins.desc}
              </li>
            ))}
          </ul>

          {lastAction.verdict.hintsUsed > 0 && (
            <p className="meta">
              −{lastAction.verdict.hintsUsed * 10} used{" "}
              {lastAction.verdict.hintsUsed} hint
              {lastAction.verdict.hintsUsed > 1 ? "s" : ""}
            </p>
          )}

          <div className="suggestion">
            Next: {lastAction.verdict.suggestion}
          </div>

          {lastAction.verdict.exchanges.length > 0 && (
            <>
              <p className="meta">Follow-up review</p>
              <div className="exchanges">
                {lastAction.verdict.exchanges.map((ex, i) => (
                  <div key={i} className="exchange">
                    <p className="exchange-q">
                      <span className="exchange-tag">
                        {ex.kind === "counterexample"
                          ? "Stress test"
                          : ex.kind === "hint"
                            ? "Hint"
                            : "Follow-up"}
                      </span>
                      {ex.question}
                    </p>
                    <p className="exchange-a">
                      <strong>You:</strong> {ex.userAnswer}
                    </p>
                    <p className="exchange-ideal">
                      <strong>Ideal:</strong> {ex.idealAnswer}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}

          <button className="btn" onClick={handleReset}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
