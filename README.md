# DSA_Friend

An AI-powered app that keeps your DSA reasoning sharp — you explain an approach out loud (or in text), and a Socratic loop grades the reasoning against a pre-authored rubric.

## Language

**TypeScript** across the monorepo (Node.js on the server, React in the browser). Shared types live in `@reason/core` so the web app and API stay aligned.

## Tech stack

pnpm workspace with three packages:

| Layer | Stack |
|---|---|
| Web | React 18, Vite |
| API | Fastify, Zod |
| Core | Pure TypeScript (scoring, state machine, recommendations) + Vitest |
| Data | PostgreSQL 16 (`pg`); in-memory fallback for local/dev |
| Content | Versioned YAML rubrics in `rubrics/` |
| LLM | Google Gemini API, with Ollama fallback for local/dev |

## Hosting

GitHub stores the code and runs CI on every push (`pnpm test` + `pnpm build`). It does not run the live app — Fastify, Gemini, and (optional) Postgres need a host.

The public URL comes from [Render](https://render.com), which deploys from this GitHub repo:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/thehellologic-arch/DSA_Friend)

1. Click **Deploy to Render** and sign in with GitHub.
2. Set `GEMINI_API_KEY` when prompted.
3. Render prints a URL like `https://dsa-friend.onrender.com`.

The free instance sleeps after idle time, so the first load after a pause can take ~30–60 seconds. Progress is in-memory on that plan unless you later attach a `DATABASE_URL` (Neon or Render Postgres).
