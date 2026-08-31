import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { parseRubric } from "@reason/core";
import { loadCatalogCache, getCatalogLoadedAt, listCachedProblems } from "./catalog-cache.js";
import {
  getProblem,
  listAllProblems,
  listRevisions,
  publishProblem,
  replaceTracks,
  upsertDraft,
} from "./catalog-repository.js";
import type { ProblemTrack } from "./track-store.js";

function assertAdmin(header: string | undefined): void {
  const expected = process.env.ADMIN_TOKEN?.trim();
  if (!expected) {
    const err = new Error("Admin disabled");
    (err as Error & { statusCode: number }).statusCode = 503;
    throw err;
  }
  const got = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    const err = new Error("Unauthorized");
    (err as Error & { statusCode: number }).statusCode = 401;
    throw err;
  }
}

function adminGuard(req: FastifyRequest, _reply: FastifyReply, done: (err?: Error) => void) {
  try {
    assertAdmin(req.headers.authorization);
    done();
  } catch (err) {
    done(err as Error);
  }
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (admin) => {
    admin.addHook("preHandler", adminGuard);

    admin.setErrorHandler((err, _req, reply) => {
      const status =
        err && typeof err === "object" && "statusCode" in err
          ? Number((err as { statusCode: number }).statusCode)
          : 500;
      const message = err instanceof Error ? err.message : "Admin error";
      return reply.status(status).send({ error: message });
    });

    admin.get("/catalog", async () => ({
      loadedAt: getCatalogLoadedAt(),
      problems: listCachedProblems().map((p) => ({
        slug: p.slug,
        pattern: p.pattern,
        difficulty: p.difficulty,
      })),
      count: listCachedProblems().length,
    }));

    admin.post("/catalog/reload", async () => loadCatalogCache());

    admin.get("/problems", async () => ({
      problems: await listAllProblems(),
    }));

    admin.get<{ Params: { id: string } }>("/problems/:id", async (req, reply) => {
      const problem = await getProblem(req.params.id);
      if (!problem) return reply.status(404).send({ error: "Not found" });
      const revisions = await listRevisions(req.params.id);
      return { problem, revisions };
    });

    admin.post<{ Body: { rubric: unknown; title?: string; topic?: string } }>(
      "/problems",
      async (req, reply) => {
        const rubric = parseRubric(req.body?.rubric);
        const doc = await upsertDraft({
          _id: rubric.problem_id,
          pattern: rubric.pattern,
          difficulty: rubric.difficulty,
          coreAsk: rubric.core_ask,
          title: req.body?.title,
          topic: req.body?.topic,
          status: "draft",
          rubric,
        });
        return reply.status(201).send({ problem: doc });
      },
    );

    admin.put<{
      Params: { id: string };
      Body: { rubric: unknown; title?: string; topic?: string };
    }>("/problems/:id", async (req) => {
      const rubric = parseRubric({
        ...(req.body?.rubric as object),
        problem_id: req.params.id,
      });
      const doc = await upsertDraft({
        _id: req.params.id,
        pattern: rubric.pattern,
        difficulty: rubric.difficulty,
        coreAsk: rubric.core_ask,
        title: req.body?.title,
        topic: req.body?.topic,
        status: "draft",
        rubric,
      });
      return { problem: doc };
    });

    admin.post<{ Params: { id: string } }>(
      "/problems/:id/publish",
      async (req) => {
        const problem = await publishProblem(req.params.id);
        return { problem };
      },
    );

    admin.put<{ Body: { tracks: ProblemTrack[] } }>("/tracks", async (req) => {
      await replaceTracks(req.body?.tracks ?? []);
      return { ok: true, count: req.body?.tracks?.length ?? 0 };
    });
  }, { prefix: "/admin" });
}
