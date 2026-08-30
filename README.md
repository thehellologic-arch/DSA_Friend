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
