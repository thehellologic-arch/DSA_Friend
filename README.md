# CoderBhaiya

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
| Data | MongoDB Atlas (problems, tracks, users, sessions, attempts); Postgres optional legacy |
| Content | Versioned rubrics in Mongo (YAML seed in `rubrics/`) |
| Auth | Username + password (unique username); login required |
| LLM | OpenRouter (Gemini Flash + fallbacks), with direct Gemini / Ollama as optional backups |

## Hosting

GitHub stores the code and runs CI on every push (`pnpm test` + `pnpm build`). It does not run the live app — Fastify, OpenRouter, and (optional) Postgres need a host.

The public URL comes from [Render](https://render.com), which deploys from this GitHub repo:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/thehellologic-arch/CoderBhaiya)

1. Click **Deploy to Render** and sign in with GitHub.
2. Set `OPENROUTER_API_KEY` when prompted.
3. Render prints a URL like `https://dsa-friend-epd7.onrender.com`.

The free instance sleeps after idle time, so the first load after a pause can take ~30–60 seconds. Progress is in-memory on that plan unless you later attach a `DATABASE_URL` (Neon or Render Postgres).

## Novel approach evaluation (shadow review)

Run the app with the novel evaluator in shadow mode, then exercise the golden corpus via the unit suite:

```bash
NOVEL_EVALUATION_MODE=shadow pnpm dev
pnpm test
```

Release gate: before enabling `NOVEL_EVALUATION_MODE=on`, review false acceptances, false rejections, abstentions, average tokens, p95 latency, and challenge rate against the expert-reviewed Two Sum corpus in `evaluation/two-sum.json`.

Shadow mode cost: unmatched validation-enabled turns run the novel evaluator **and** the classifier, so per-turn LLM cost is additive versus `NOVEL_EVALUATION_MODE=off` (evaluator only in `on`; classifier only in `off` for those turns).
