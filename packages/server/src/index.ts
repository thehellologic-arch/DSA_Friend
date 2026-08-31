import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { isSkillLevel, type SkillLevel } from "@reason/core";
import { createProgressRepository } from "./create-progress-repo.js";
import { GeminiProvider } from "./gemini-provider.js";
import { ensureGuest } from "./guest.js";
import { JudgingService } from "./judging-service.js";
import { OllamaProvider } from "./ollama-provider.js";
import { OpenAIProvider } from "./openai-provider.js";
import { ProgressService } from "./progress-service.js";
import { getRubric, listProblems, loadRubrics } from "./rubric-store.js";
import { loadTracks } from "./track-store.js";
import {
  getTranscript,
  InMemorySessionStore,
} from "./session-store.js";

const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT ?? 3001);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL ?? "google/gemini-3.6-flash";
const OPENROUTER_FALLBACK_MODELS = (
  process.env.OPENROUTER_FALLBACK_MODELS ??
  "google/gemini-2.5-flash,deepseek/deepseek-chat"
)
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL ??
  (isProd ? "" : "https://sadly-oversight-shun.ngrok-free.dev");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:26b";

if (!OPENROUTER_API_KEY && !GEMINI_API_KEY && !OLLAMA_BASE_URL) {
  console.error(
    "Set OPENROUTER_API_KEY (or GEMINI_API_KEY / OLLAMA_BASE_URL) before starting the server.",
  );
  process.exit(1);
}

loadTracks();
loadRubrics();

function knownPatterns(): string[] {
  return [...new Set(listProblems().map((problem) => problem.pattern))];
}

const store = new InMemorySessionStore();
const llm = OPENROUTER_API_KEY
  ? new OpenAIProvider({
      apiKey: OPENROUTER_API_KEY,
      baseUrl:
        process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
      model: OPENROUTER_MODEL,
      fallbackModels: OPENROUTER_FALLBACK_MODELS,
      referer:
        process.env.OPENROUTER_REFERER ??
        "https://github.com/thehellologic-arch/DSA_Friend",
      title: "DSA Friend",
    })
  : GEMINI_API_KEY
    ? new GeminiProvider({
        apiKey: GEMINI_API_KEY,
        model: GEMINI_MODEL,
      })
    : new OllamaProvider({
        baseUrl: OLLAMA_BASE_URL,
        model: OLLAMA_MODEL,
      });
const llmLabel = OPENROUTER_API_KEY
  ? `OpenRouter (${OPENROUTER_MODEL})`
  : GEMINI_API_KEY
    ? `Gemini (${GEMINI_MODEL})`
    : `Ollama ${OLLAMA_BASE_URL} (${OLLAMA_MODEL})`;
const progressRepo = await createProgressRepository();
const progress = new ProgressService(progressRepo, () => listProblems());
const judging = new JudgingService(store, llm, progress);

const app = Fastify({ logger: true, trustProxy: true });
await app.register(cors, { origin: true, credentials: true });
await app.register(cookie);

app.get("/health", async () => ({ ok: true }));

await app.register(async (api) => {
  api.get<{ Querystring: { pattern?: string; difficulty?: string } }>(
    "/problems",
    async (req) => {
      if (!isProd) {
        loadTracks();
        loadRubrics();
      }
      const pattern = req.query.pattern?.trim();
      const difficulty = req.query.difficulty
        ? Number(req.query.difficulty)
        : undefined;
      let problems = listProblems();
      if (pattern) {
        problems = problems.filter((problem) => problem.pattern === pattern);
      }
      if (Number.isFinite(difficulty)) {
        problems = problems.filter(
          (problem) => problem.difficulty === difficulty,
        );
      }
      return { problems };
    },
  );

  api.get("/me/progress", async (req, reply) => {
    const userId = await ensureGuest(req, reply, progress, knownPatterns());
    return progress.getProgress(userId);
  });

  api.get("/me/roadmap", async (req, reply) => {
    if (!isProd) {
      loadTracks();
      loadRubrics();
    }
    const userId = await ensureGuest(req, reply, progress, knownPatterns());
    return progress.getRoadmap(userId);
  });

  api.get("/me/attempts", async (req, reply) => {
    const userId = await ensureGuest(req, reply, progress, knownPatterns());
    return { attempts: await progress.listAttempts(userId) };
  });

  api.get<{ Querystring: { pattern?: string; difficulty?: string } }>(
    "/me/recommend",
    async (req, reply) => {
      const userId = await ensureGuest(req, reply, progress, knownPatterns());
      const pattern = req.query.pattern?.trim();
      const difficulty = req.query.difficulty
        ? Number(req.query.difficulty)
        : undefined;
      const problems = await progress.recommend(userId, 5, undefined, {
        pattern: pattern || undefined,
        difficulty: Number.isFinite(difficulty) ? difficulty : undefined,
      });
      return { problems };
    },
  );

  api.post<{ Body: { skillLevel?: SkillLevel } }>(
    "/me/skill-level",
    async (req, reply) => {
      const skillLevel = req.body?.skillLevel;
      if (!skillLevel || !isSkillLevel(skillLevel)) {
        return reply.status(400).send({ error: "skillLevel is required" });
      }
      const userId = await ensureGuest(
        req,
        reply,
        progress,
        knownPatterns(),
        skillLevel,
      );
      await progress.setSkillLevel(userId, skillLevel, knownPatterns(), true);
      return progress.getProgress(userId);
    },
  );

  api.post<{ Body: { problemSlug: string } }>("/sessions", async (req, reply) => {
    const { problemSlug } = req.body ?? {};
    if (!problemSlug) {
      return reply.status(400).send({ error: "problemSlug is required" });
    }

    const rubric = getRubric(problemSlug);
    if (!rubric) {
      return reply.status(404).send({ error: "Problem not found" });
    }

    const userId = await ensureGuest(req, reply, progress, knownPatterns());
    const session = store.create(problemSlug, rubric, userId);
    const summary = listProblems().find((problem) => problem.slug === problemSlug);
    return {
      sessionId: session.id,
      coreAsk: rubric.core_ask,
      title: summary?.title,
      topic: summary?.topic,
      pattern: rubric.pattern,
      difficulty: rubric.difficulty,
      sampleExample: rubric.optimal.examples[0],
      state: session.context.state,
    };
  });

  api.get<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
    const session = store.get(req.params.id);
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    return {
      sessionId: session.id,
      problemSlug: session.problemSlug,
      coreAsk: session.rubric.core_ask,
      pattern: session.rubric.pattern,
      difficulty: session.rubric.difficulty,
      state: session.context.state,
      hintsUsed: session.context.hintsUsed,
      insightResults: session.context.insightResults,
      transcript: getTranscript(session),
      turns: session.turns,
    };
  });

  api.post<{
    Params: { id: string };
    Body: { message: string; idempotencyKey: string };
  }>("/sessions/:id/turns", async (req, reply) => {
    const { message, idempotencyKey } = req.body ?? {};
    if (!message?.trim()) {
      return reply.status(400).send({ error: "message is required" });
    }
    if (!idempotencyKey) {
      return reply.status(400).send({ error: "idempotencyKey is required" });
    }

    try {
      const result = await judging.handleTurn(
        req.params.id,
        message.trim(),
        idempotencyKey,
      );
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg === "Session not found") {
        return reply.status(404).send({ error: msg });
      }
      req.log.error(err);
      return reply.status(502).send({ error: `Judging failed: ${msg}` });
    }
  });

  api.post<{
    Params: { id: string };
    Body: { idempotencyKey: string };
  }>("/sessions/:id/verdict", async (req, reply) => {
    const { idempotencyKey } = req.body ?? {};
    if (!idempotencyKey) {
      return reply.status(400).send({ error: "idempotencyKey is required" });
    }

    try {
      return await judging.revealVerdict(req.params.id, idempotencyKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message === "Session not found") {
        return reply.status(404).send({ error: message });
      }
      req.log.error(err);
      return reply.status(500).send({ error: `Verdict failed: ${message}` });
    }
  });
}, { prefix: "/api" });

const webDist = path.resolve(__dirname, "../../web/dist");
if (fs.existsSync(path.join(webDist, "index.html"))) {
  await app.register(fastifyStatic, {
    root: webDist,
    wildcard: false,
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== "GET" || req.url.startsWith("/api")) {
      return reply.status(404).send({ error: "Not found" });
    }
    return reply.sendFile("index.html");
  });
}

app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`LLM: ${llmLabel}`);
});
