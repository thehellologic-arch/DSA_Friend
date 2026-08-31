import { useState, type FormEvent } from "react";
import { login, register, type AuthUser } from "../api";

interface Props {
  onAuthed: (user: AuthUser) => void;
}

export default function AuthScreen({ onAuthed }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user =
        mode === "login"
          ? await login(username.trim(), password)
          : await register(username.trim(), password);
      onAuthed(user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app auth-app">
      <header className="header">
        <h1 className="screen-title">DSA Friend</h1>
      </header>
      <section className="card auth-card">
        <h2>{mode === "login" ? "Log in" : "Create account"}</h2>
        <p className="meta">
          Username and password only. Usernames must be unique.
        </p>
        <form className="auth-form" onSubmit={submit}>
          <label className="auth-label">
            Username
            <input
              className="auth-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_]+"
              required
            />
          </label>
          <label className="auth-label">
            Password
            <input
              className="auth-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              minLength={6}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary-btn" type="submit" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "login"
                ? "Log in"
                : "Register"}
          </button>
        </form>
        <button
          type="button"
          className="text-btn"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login"
            ? "Need an account? Register"
            : "Already have an account? Log in"}
        </button>
      </section>
    </div>
  );
}
