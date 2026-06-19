import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import cors from "@fastify/cors";
import Fastify from "fastify";
import { getTranscript } from "./session-store.js";
import { loadRubrics, getRubric, listProblems } from "./rubric-store.js";
import { OllamaProvider } from "./ollama-provider.js";
import { InMemorySessionStore } from "./session-store.js";
import { JudgingService } from "./judging-service.js";

const PORT = Number(process.env.PORT ?? 3001);
const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL ??
  "https://sadly-oversight-shun.ngrok-free.dev";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:26b";

loadRubrics();

const store = new InMemorySessionStore();
const llm = new OllamaProvider({
  baseUrl: OLLAMA_BASE_URL,
  model: OLLAMA_MODEL,
});
const judging = new JudgingService(store, llm);

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get("/problems", async () => {
  return { problems: listProblems() };
});

app.post<{ Body: { problemSlug: string } }>("/sessions", async (req, reply) => {
  const { problemSlug } = req.body ?? {};
  if (!problemSlug) {
    return reply.status(400).send({ error: "problemSlug is required" });
  }

  const rubric = getRubric(problemSlug);
  if (!rubric) {
    return reply.status(404).send({ error: "Problem not found" });
  }

  const session = store.create(problemSlug, rubric);
  return {
    sessionId: session.id,
    coreAsk: rubric.core_ask,
    pattern: rubric.pattern,
    difficulty: rubric.difficulty,
    state: session.context.state,
  };
});

app.get<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
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

app.post<{
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

app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`LLM: ${OLLAMA_BASE_URL} (${OLLAMA_MODEL})`);
});
