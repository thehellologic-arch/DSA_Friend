import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: path.resolve(__dirname, "../../../.env"),
  override: true,
});

import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { isSkillLevel, type SkillLevel } from "@reason/core";
import { registerAdminRoutes } from "./admin-routes.js";
import {
  AuthError,
  createAuthService,
  type AuthService,
} from "./auth-service.js";
import {
  clearUserCookie,
  requireAuth,
  writeUserCookie,
} from "./auth.js";
import { loadCatalogCache } from "./catalog-cache.js";
import { createProgressRepository } from "./create-progress-repo.js";
import { resolveNovelEvaluationMode } from "./evaluation-metrics.js";
import { GeminiProvider } from "./gemini-provider.js";
import { JudgingService } from "./judging-service.js";
import { isMongoConfigured } from "./mongo.js";
import { OllamaProvider } from "./ollama-provider.js";
import { OpenAIProvider } from "./openai-provider.js";
import { ProgressService } from "./progress-service.js";
import {
  clearYamlCatalogFallback,
  getRubric,
  listProblems,
  loadRubrics,
} from "./rubric-store.js";
import {
  createSessionStore,
  getTranscript,
} from "./session-store.js";
import {
  clearYamlTrackFallback,
  loadTracks,
} from "./track-store.js";

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

if (isMongoConfigured()) {
  try {
    const loaded = await loadCatalogCache();
    clearYamlCatalogFallback();
    clearYamlTrackFallback();
    console.info(
      `Catalog cache loaded: ${loaded.problems} problems, ${loaded.tracks} tracks`,
    );
  } catch (err) {
    console.warn(
      "Mongo catalog unavailable; falling back to YAML",
      err instanceof Error ? err.message : err,
    );
    loadTracks();
    loadRubrics();
  }
} else {
  loadTracks();
  loadRubrics();
}

function knownPatterns(): string[] {
  return [...new Set(listProblems().map((problem) => problem.pattern))];
}

const store = await createSessionStore();
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
const llmModel = OPENROUTER_API_KEY
  ? OPENROUTER_MODEL
  : GEMINI_API_KEY
    ? GEMINI_MODEL
    : OLLAMA_MODEL;
const progressRepo = await createProgressRepository();
const progress = new ProgressService(progressRepo, () => listProblems());

let auth: AuthService | null = null;
if (isMongoConfigured()) {
  try {
    auth = await createAuthService();
    console.info("Auth service ready (username/password)");
  } catch (err) {
    console.error(
      "Auth requires MongoDB",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  }
} else {
  console.error("MONGODB_URI is required for login/registration");
  process.exit(1);
}

const novelEvaluationMode = resolveNovelEvaluationMode();

const app = Fastify({ logger: true, trustProxy: true });
const judging = new JudgingService(store, llm, progress, {
  mode: novelEvaluationMode,
  model: llmModel,
  logEvaluation: (event) => {
    app.log.info(event);
  },
});
await app.register(cors, { origin: true, credentials: true });
await app.register(cookie);

app.get("/health", async () => ({ ok: true }));

await registerAdminRoutes(app);

async function withAuth(
  req: Parameters<typeof requireAuth>[0],
  reply: Parameters<typeof requireAuth>[1],
) {
  try {
    return await requireAuth(req, reply, auth!, progress, knownPatterns());
  } catch (err) {
    if (err instanceof Error && err.message === "LOGIN_REQUIRED") {
      return null;
    }
    throw err;
  }
}

await app.register(async (api) => {
  api.post<{ Body: { username?: string; password?: string } }>(
    "/auth/register",
    async (req, reply) => {
      try {
        const user = await auth!.register(
          req.body?.username ?? "",
          req.body?.password ?? "",
        );
        writeUserCookie(reply, user.id);
        await progress.ensureUser(user.id, user.skillLevel, knownPatterns());
        return {
          userId: user.id,
          username: user.username,
          onboarded: user.onboarded,
          skillLevel: user.skillLevel,
        };
      } catch (err) {
        if (err instanceof AuthError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  api.post<{ Body: { username?: string; password?: string } }>(
    "/auth/login",
    async (req, reply) => {
      try {
        const user = await auth!.login(
          req.body?.username ?? "",
          req.body?.password ?? "",
        );
        writeUserCookie(reply, user.id);
        await progress.ensureUser(user.id, user.skillLevel, knownPatterns());
        return {
          userId: user.id,
          username: user.username,
          onboarded: user.onboarded,
          skillLevel: user.skillLevel,
        };
      } catch (err) {
        if (err instanceof AuthError) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  api.post("/auth/logout", async (_req, reply) => {
    clearUserCookie(reply);
    return { ok: true };
  });

  api.get("/auth/me", async (req, reply) => {
    const user = await withAuth(req, reply);
    if (!user) return;
    return {
      userId: user.id,
      username: user.username,
      onboarded: user.onboarded,
      skillLevel: user.skillLevel,
    };
  });

  api.get<{ Querystring: { pattern?: string; difficulty?: string } }>(
    "/problems",
    async (req, reply) => {
      const user = await withAuth(req, reply);
      if (!user) return;
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
    const user = await withAuth(req, reply);
    if (!user) return;
    return progress.getProgress(user.id);
  });

  api.get("/me/roadmap", async (req, reply) => {
    const user = await withAuth(req, reply);
    if (!user) return;
    return progress.getRoadmap(user.id);
  });

  api.get("/me/attempts", async (req, reply) => {
    const user = await withAuth(req, reply);
    if (!user) return;
    return { attempts: await progress.listAttempts(user.id) };
  });

  api.get<{ Querystring: { pattern?: string; difficulty?: string } }>(
    "/me/recommend",
    async (req, reply) => {
      const user = await withAuth(req, reply);
      if (!user) return;
      const pattern = req.query.pattern?.trim();
      const difficulty = req.query.difficulty
        ? Number(req.query.difficulty)
        : undefined;
      const problems = await progress.recommend(user.id, 5, undefined, {
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
      const user = await withAuth(req, reply);
      if (!user) return;
      await progress.setSkillLevel(user.id, skillLevel, knownPatterns(), true);
      return progress.getProgress(user.id);
    },
  );

  api.post<{ Body: { problemSlug: string } }>("/sessions", async (req, reply) => {
    const user = await withAuth(req, reply);
    if (!user) return;
    const { problemSlug } = req.body ?? {};
    if (!problemSlug) {
      return reply.status(400).send({ error: "problemSlug is required" });
    }

    const rubric = getRubric(problemSlug);
    if (!rubric) {
      return reply.status(404).send({ error: "Problem not found" });
    }

    const session = await store.create(problemSlug, rubric, user.id);
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
    const user = await withAuth(req, reply);
    if (!user) return;
    const session = await store.get(req.params.id);
    if (!session || session.userId !== user.id) {
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
    const user = await withAuth(req, reply);
    if (!user) return;
    const session = await store.get(req.params.id);
    if (!session || session.userId !== user.id) {
      return reply.status(404).send({ error: "Session not found" });
    }

    const { message, idempotencyKey } = req.body ?? {};
    if (!message?.trim()) {
      return reply.status(400).send({ error: "message is required" });
    }
    if (!idempotencyKey) {
      return reply.status(400).send({ error: "idempotencyKey is required" });
    }

    try {
      return await judging.handleTurn(
        req.params.id,
        message.trim(),
        idempotencyKey,
      );
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
    const user = await withAuth(req, reply);
    if (!user) return;
    const session = await store.get(req.params.id);
    if (!session || session.userId !== user.id) {
      return reply.status(404).send({ error: "Session not found" });
    }

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
