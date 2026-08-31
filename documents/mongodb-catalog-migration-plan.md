# MongoDB Catalog, Progress, and Admin Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist problems (versioned rubrics + tracks), user progress, and sessions in MongoDB Atlas; load the catalog into an in-memory cache at server start; provide an authenticated admin portal to add/publish problems and reload the cache without a redeploy.

**Architecture:** Atlas is the runtime source of truth for published content and all user state. YAML under `rubrics/` and `tracks/` remains the bootstrap/seed source for the first cut. The server builds a catalog cache at boot (problems + tracks) and swaps it atomically on `POST /admin/catalog/reload`. Sessions pin a frozen rubric snapshot. Admin auth is a shared `ADMIN_TOKEN` bearer secret (no user accounts yet).

**Tech Stack:** TypeScript, Fastify, MongoDB Node driver (`mongodb`), Zod (`parseRubric`), Vitest, React (admin pages in `@reason/web`), MongoDB Atlas Free (M0).

## Global Constraints

- Atlas org: https://cloud.mongodb.com/v2#/org/6a95b2e7fa28f9e43e1183e3/access/users — use Free (M0) cluster; store connection string in `MONGODB_URI` (never commit secrets).
- Validation cases use **curated `output` fields** — oracles are removed; never send expected outputs to the LLM.
- Never mutate an existing `{ problemId, rubricVersion }` revision; publish = insert revision + update current `problems` doc.
- Catalog cache: **build-then-swap** (never clear-then-fill under live traffic).
- Do not persist derived `level` or topic `status` — compute via `ratingToLevel` / `deriveTopicStatus`.
- Mastered insights must be keyed as `problemId:insightId` (insight ids collide across problems in the same pattern, e.g. `complexity`).
- Keep ports: `ProgressRepository`, catalog accessors; no Mongo types in `@reason/core`.
- Admin routes fail closed if `ADMIN_TOKEN` is unset; do not share the public CORS plugin.
- In-flight sessions keep their pinned rubric snapshot; reload does not affect them.
- `plausible_unverified` still does not update Elo/mastery.
- Prefer one Render instance for v1 (reload refreshes that process only).

## File structure (target)

| Path | Responsibility |
| --- | --- |
| `packages/server/src/mongo.ts` | Shared Mongo client / db accessor |
| `packages/server/src/catalog-types.ts` | Mongo document shapes for problems, revisions, tracks |
| `packages/server/src/catalog-repository.ts` | CRUD + publish for problems/tracks/revisions |
| `packages/server/src/catalog-cache.ts` | In-memory cache; load/swap; accessors |
| `packages/server/src/seed-catalog.ts` | YAML → Mongo seed script entry |
| `packages/server/src/mongo-progress-repository.ts` | ProgressRepository on Mongo |
| `packages/server/src/create-progress-repo.ts` | Prefer Mongo when `MONGODB_URI` set |
| `packages/server/src/session-store.ts` | Persist sessions in Mongo (replace pure in-memory) |
| `packages/server/src/admin-routes.ts` | Bearer-auth admin API |
| `packages/web/src/screens/AdminScreen.tsx` | Minimal admin UI (list / add / publish / reload) |
| `packages/server/src/rubric-store.ts` | Thin wrappers over catalog-cache (compat) |
| `packages/server/src/track-store.ts` | Thin wrappers over catalog-cache (compat) |
| `documents/mongodb-catalog-design.md` | Short design note (schema + rollout) |

---

### Task 1: Mongo connection + document types

**Files:**
- Create: `packages/server/src/mongo.ts`
- Create: `packages/server/src/catalog-types.ts`
- Modify: `packages/server/package.json` (add `mongodb` dependency)
- Modify: `docker-compose.yml` (optional local mongo for offline; Atlas preferred)
- Modify: `.env.example` if present, else document env vars in README

**Interfaces:**
- Produces: `getDb(): Promise<Db>`, `closeMongo(): Promise<void>`
- Produces types: `ProblemDoc`, `RubricRevisionDoc`, `TrackDoc`

- [ ] **Step 1: Add dependency**

```bash
pnpm --filter @reason/server add mongodb
```

- [ ] **Step 2: Add types**

```ts
// packages/server/src/catalog-types.ts
import type { Rubric } from "@reason/core";
import type { ProblemTrack } from "./track-store.js";

export type ProblemStatus = "draft" | "published" | "archived";

export interface ProblemDoc {
  _id: string; // problem slug / problem_id
  pattern: string;
  difficulty: number;
  coreAsk: string;
  title?: string;
  topic?: string;
  status: ProblemStatus;
  rubricVersion: number;
  schemaVersion: 1;
  rubric: Rubric;
  publishedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
}

export interface RubricRevisionDoc {
  _id: string; // `${problemId}:v${rubricVersion}`
  problemId: string;
  rubricVersion: number;
  rubric: Rubric;
  publishedAt: Date;
}

export type TrackDoc = ProblemTrack & {
  updatedAt: Date;
};
```

- [ ] **Step 3: Add mongo helper**

```ts
// packages/server/src/mongo.ts
import { MongoClient, type Db } from "mongodb";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  if (db) return db;
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(process.env.MONGODB_DB ?? "reason");
  return db;
}

export async function closeMongo(): Promise<void> {
  await client?.close();
  client = null;
  db = null;
}
```

- [ ] **Step 4: Ensure Atlas cluster exists**

In the Atlas org linked above, create/select an M0 Free cluster, create a DB user, allow the Render egress IP (or `0.0.0.0/0` for early prototyping), copy the `mongodb+srv://…` URI into local `.env` as `MONGODB_URI` and into Render env vars (`sync: false`).

- [ ] **Step 5: Commit**

```bash
git add packages/server/package.json pnpm-lock.yaml packages/server/src/mongo.ts packages/server/src/catalog-types.ts
git commit -m "Add MongoDB client wiring and catalog document types."
```

---

### Task 2: Catalog repository (versioned publish)

**Files:**
- Create: `packages/server/src/catalog-repository.ts`
- Create: `packages/server/src/catalog-repository.test.ts`

**Interfaces:**
- Consumes: `getDb`, `ProblemDoc`, `RubricRevisionDoc`, `TrackDoc`, `parseRubric`
- Produces:
  - `ensureCatalogIndexes()`
  - `listPublishedProblems(): Promise<ProblemDoc[]>`
  - `listTracks(): Promise<TrackDoc[]>`
  - `getProblem(id): Promise<ProblemDoc | null>`
  - `upsertDraft(input): Promise<ProblemDoc>`
  - `publishProblem(id): Promise<ProblemDoc>` — bumps version, writes immutable revision
  - `replaceTracks(tracks): Promise<void>`

- [ ] **Step 1: Write failing publish test**

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { parseRubric } from "@reason/core";
import { getDb, closeMongo } from "./mongo.js";
import {
  ensureCatalogIndexes,
  publishProblem,
  upsertDraft,
  getProblem,
} from "./catalog-repository.js";

const run = process.env.MONGODB_URI ? describe : describe.skip;

run("catalog-repository", () => {
  beforeAll(async () => {
    await ensureCatalogIndexes();
  });
  afterAll(async () => {
    await closeMongo();
  });

  it("publishes an immutable revision and bumps current version", async () => {
    const rubric = parseRubric({
      problem_id: "test-mongo-publish",
      rubric_version: 1,
      pattern: "hashing",
      difficulty: 900,
      core_ask: "test",
      optimal: {
        approach: "a",
        complexity: { time: "O(n)", space: "O(1)" },
        key_insight: "k",
        examples: [{ input: "i", output: "o", explanation: "e" }],
      },
      acceptable_alternatives: [],
      common_wrong_approaches: [],
      required_insights: [
        { id: "x", desc: "d", weight: 1, hints: ["h"] },
      ],
      edge_cases: [],
      scoring: {
        formula: "f",
        hint_penalty_per_reveal: 0.1,
        self_correction_bonus: 0.05,
      },
    });

    await upsertDraft({
      _id: "test-mongo-publish",
      pattern: rubric.pattern,
      difficulty: rubric.difficulty,
      coreAsk: rubric.core_ask,
      status: "draft",
      rubric,
    });

    const published = await publishProblem("test-mongo-publish");
    expect(published.status).toBe("published");
    expect(published.rubricVersion).toBe(1);

    const db = await getDb();
    const rev = await db.collection("rubric_revisions").findOne({
      _id: "test-mongo-publish:v1",
    });
    expect(rev).toBeTruthy();

    // second publish creates v2; v1 untouched
    published.rubric.core_ask = "changed";
    await upsertDraft({
      _id: "test-mongo-publish",
      pattern: published.pattern,
      difficulty: published.difficulty,
      coreAsk: "changed",
      status: "draft",
      rubric: { ...published.rubric, core_ask: "changed", rubric_version: 2 },
    });
    const v2 = await publishProblem("test-mongo-publish");
    expect(v2.rubricVersion).toBe(2);
    const stillV1 = await db.collection("rubric_revisions").findOne({
      _id: "test-mongo-publish:v1",
    });
    expect((stillV1 as { rubric: { core_ask: string } }).rubric.core_ask).toBe(
      "test",
    );
  });
});
```

- [ ] **Step 2: Run test — expect fail**

```bash
MONGODB_URI='…' pnpm --filter @reason/server test -- catalog-repository
```

Expected: FAIL (module / functions missing).

- [ ] **Step 3: Implement repository**

Key behaviors:
- Indexes: unique `{ problemId, rubricVersion }` on `rubric_revisions`; `{ status: 1, pattern: 1, difficulty: 1 }` on `problems`.
- `publishProblem`: load draft/current → set `rubric.rubric_version` → `insertOne` revision (fail if duplicate) → `$set` current problem `status: published`, `rubricVersion`, `rubric`, `publishedAt`.
- Reject publish if any validation case is missing `output` (Zod via `parseRubric` already enforces this).

- [ ] **Step 4: Re-run test — expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/catalog-repository.ts packages/server/src/catalog-repository.test.ts
git commit -m "Add versioned Mongo catalog repository."
```

---

### Task 3: Catalog cache (boot load + atomic swap)

**Files:**
- Create: `packages/server/src/catalog-cache.ts`
- Create: `packages/server/src/catalog-cache.test.ts`
- Modify: `packages/server/src/rubric-store.ts`
- Modify: `packages/server/src/track-store.ts`
- Modify: `packages/server/src/index.ts` (boot sequence)

**Interfaces:**
- Produces:
  - `loadCatalogCache(): Promise<{ problems: number; tracks: number; loadedAt: string }>`
  - `getCachedRubric(slug): Rubric | undefined`
  - `listCachedProblems(): ProblemSummary[]`
  - `listCachedTracks(): ProblemTrack[]`
  - `titleForSlug` / `topicForSlug` / `blind75Order` via cache

- [ ] **Step 1: Implement cache with build-then-swap**

```ts
// packages/server/src/catalog-cache.ts
import type { Rubric } from "@reason/core";
import type { ProblemSummary } from "./rubric-store.js";
import type { ProblemTrack } from "./track-store.js";
import {
  listPublishedProblems,
  listTracksFromDb,
} from "./catalog-repository.js";

interface CatalogSnapshot {
  rubrics: Map<string, Rubric>;
  problems: ProblemSummary[];
  tracks: ProblemTrack[];
  loadedAt: string;
}

let snapshot: CatalogSnapshot = {
  rubrics: new Map(),
  problems: [],
  tracks: [],
  loadedAt: new Date(0).toISOString(),
};

export async function loadCatalogCache() {
  const docs = await listPublishedProblems();
  const tracks = await listTracksFromDb();
  const rubrics = new Map(docs.map((d) => [d._id, d.rubric]));
  const problems: ProblemSummary[] = docs.map((d) => ({
    slug: d._id,
    pattern: d.pattern,
    difficulty: d.difficulty,
    coreAsk: d.coreAsk,
    title: d.title,
    topic: d.topic,
  }));
  // sort by blind-75 order from tracks (same logic as today)
  snapshot = {
    rubrics,
    problems: sortByTrack(problems, tracks),
    tracks,
    loadedAt: new Date().toISOString(),
  };
  return {
    problems: problems.length,
    tracks: tracks.length,
    loadedAt: snapshot.loadedAt,
  };
}

export function getCachedRubric(slug: string) {
  return snapshot.rubrics.get(slug);
}
export function listCachedProblems() {
  return snapshot.problems;
}
export function listCachedTracks() {
  return snapshot.tracks;
}
```

- [ ] **Step 2: Point rubric-store / track-store at cache**

Keep exported function names (`loadRubrics`, `getRubric`, `listProblems`, `loadTracks`, `listTracks`, …) as thin wrappers so `index.ts` and `ProgressService` keep working. Remove filesystem reads from the hot path (keep them only in the seed script).

- [ ] **Step 3: Boot sequence in `index.ts`**

```ts
if (process.env.MONGODB_URI) {
  await loadCatalogCache();
} else {
  // local fallback while migrating
  loadTracksFromYaml();
  loadRubricsFromYaml();
}
```

- [ ] **Step 4: Unit test swap atomicity with a fake repo** (injectable loader) — assert readers never see empty mid-reload.

- [ ] **Step 5: Commit**

```bash
git commit -m "Load published catalog into an atomic in-memory cache."
```

---

### Task 4: YAML seed script

**Files:**
- Create: `packages/server/src/seed-catalog.ts`
- Modify: `packages/server/package.json` script `"seed:catalog": "tsx src/seed-catalog.ts"`

**Interfaces:**
- Consumes: filesystem YAML loaders (current `loadRubrics`/`loadTracks` logic extracted), `upsertDraft`, `publishProblem`, `replaceTracks`
- Produces: CLI that upserts all YAML rubrics as published v1 (or bumps only when body hash changes)

- [ ] **Step 1: Implement seed**

Behavior:
1. Read every `rubrics/*.yaml`, `parseRubric`.
2. For each: if no Mongo doc → insert + publish as v1.
3. If doc exists and rubric body deeply equals current → skip.
4. If body differs → upsert draft with `rubric_version = current+1`, publish.
5. Read `tracks/*.yaml`, `replaceTracks`.
6. Print counts: inserted / updated / skipped.

- [ ] **Step 2: Run against Atlas**

```bash
MONGODB_URI='…' pnpm --filter @reason/server seed:catalog
```

Expected: ~76 problems, 1 track.

- [ ] **Step 3: Commit**

```bash
git commit -m "Add YAML-to-Mongo catalog seed script."
```

---

### Task 5: Mongo progress repository (users, topics, attempts)

**Files:**
- Create: `packages/server/src/mongo-progress-repository.ts`
- Modify: `packages/server/src/progress-repository.ts` (extend user row shape if needed)
- Modify: `packages/server/src/create-progress-repo.ts`
- Modify: `packages/server/src/progress-service.ts` (use `masteredInsightKeys`, `completedProblemIds`)
- Create: `packages/server/src/mongo-progress-repository.test.ts`

**Interfaces:**
- User document:

```ts
{
  _id: string;
  skillLevel: SkillLevel;
  onboarded: boolean;
  createdAt: Date;
  completedProblemIds: string[]; // for roadmap without full attempt scan
  topics: Array<{
    pattern: string;
    rating: number;
    masteryPercent: number;
    problemsCompleted: number;
    hintUsage: number;
    lastPracticedAt: string | null;
    recentPerformance: number[]; // max 5
    masteredInsightKeys: string[]; // `${problemId}:${insightId}`
  }>;
}
```

- Attempt document: same fields as `StoredAttempt` / `CreateAttemptInput`, plus `rubricVersion`.
- Drop separate `rating_events` collection — store `{ before, after, delta }` on the attempt.

- [ ] **Step 1: Fix mastery keying in ProgressService**

Replace pattern-scoped insight id set with:

```ts
const key = `${input.problemSlug}:${insight.id}`;
previousYes.has(key);
```

and persist `masteredInsightKeys` on the topic.

- [ ] **Step 2: Implement `MongoProgressRepository`** satisfying `ProgressRepository`.

`recordVerdict` path (in service or repo):
1. `insertOne` attempt (unique `sessionId`) — idempotent.
2. Update user topic + `completedProblemIds` with `$addToSet`.
Prefer a transaction when available (Atlas M0 is a replica set). Fallback: attempt insert first, then guarded topic update with `lastAppliedAttemptId`.

- [ ] **Step 3: Wire `createProgressRepository`**

```ts
if (process.env.MONGODB_URI) {
  await ensureProgressIndexes();
  return new MongoProgressRepository(await getDb());
}
// existing Postgres / memory fallbacks for local without Mongo
```

- [ ] **Step 4: Tests for idempotent `sessionId` and masteredInsightKeys across two trie problems both having insight `complexity`.

- [ ] **Step 5: Commit**

```bash
git commit -m "Persist user progress and attempts in MongoDB."
```

---

### Task 6: Persist sessions in Mongo

**Files:**
- Modify: `packages/server/src/session-store.ts`
- Create: `packages/server/src/mongo-session-store.ts`

**Interfaces:**
- Session doc embeds: `rubric` snapshot, `context`, `turns[]` (bounded), `rubricVersion`, `problemId`, `userId`, timestamps.
- `idempotencyCache`: store as object map `Record<string, TurnAction>` (Map is not BSON-friendly).

- [ ] **Step 1: Implement `MongoSessionStore` with same methods as `InMemorySessionStore`** (`create`, `get`, plus `save` after each turn).

- [ ] **Step 2: On create, copy rubric from catalog cache (pinned snapshot).

- [ ] **Step 3: Wire in `index.ts` when Mongo is configured.

- [ ] **Step 4: Commit**

```bash
git commit -m "Persist practice sessions in MongoDB."
```

---

### Task 7: Admin API (auth + CRUD + reload)

**Files:**
- Create: `packages/server/src/admin-auth.ts`
- Create: `packages/server/src/admin-routes.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `render.yaml` (`ADMIN_TOKEN` env, `sync: false`)

**Interfaces:**
- `Authorization: Bearer <ADMIN_TOKEN>` via `timingSafeEqual`
- Fail closed if token unset
- Routes (prefix `/admin`, separate from public CORS plugin):

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/admin/catalog` | Cached slugs + versions + `loadedAt` |
| POST | `/admin/catalog/reload` | `loadCatalogCache()` → counts |
| GET | `/admin/problems` | List Mongo problems (any status) |
| GET | `/admin/problems/:id` | Full doc + recent revisions |
| POST | `/admin/problems` | Create draft (body = rubric YAML/JSON); `parseRubric` required |
| PUT | `/admin/problems/:id` | Update draft body |
| POST | `/admin/problems/:id/publish` | Publish new immutable version |
| PUT | `/admin/tracks` | Replace tracks document(s) |

- [ ] **Step 1: Auth helper**

```ts
import { timingSafeEqual } from "node:crypto";

export function assertAdmin(header: string | undefined): void {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) throw Object.assign(new Error("Admin disabled"), { statusCode: 503 });
  const got = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }
}
```

- [ ] **Step 2: Register routes + tests** with fake token.

- [ ] **Step 3: Manual smoke**

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/catalog
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/catalog/reload
```

- [ ] **Step 4: Commit**

```bash
git commit -m "Add authenticated admin catalog API and cache reload."
```

---

### Task 8: Admin portal UI

**Files:**
- Create: `packages/web/src/screens/AdminScreen.tsx`
- Modify: `packages/web/src/App.tsx` (route `/admin`)
- Modify: `packages/web/src/api.ts` (admin fetch helpers; token from `sessionStorage` prompt or local input — never hardcode)

**UI (minimal, one composition):**
1. Token gate (paste admin token once per browser session).
2. Catalog status: problem count, `loadedAt`, **Reload cache** button.
3. Problem list: slug, status, version, pattern, difficulty.
4. Add / Edit form: JSON (or YAML textarea) of full rubric → create/update draft.
5. **Publish** button → then optional auto-reload cache checkbox.

- [ ] **Step 1: Build AdminScreen wired to `/admin/*`.**

- [ ] **Step 2: Manual test — add a draft, publish, reload, confirm `/api/problems` shows it without server restart.**

- [ ] **Step 3: Commit**

```bash
git commit -m "Add admin portal for problem publish and cache reload."
```

---

### Task 9: Cut over deploy + cleanup

**Files:**
- Modify: `render.yaml` — add `MONGODB_URI`, `MONGODB_DB`, `ADMIN_TOKEN`
- Modify: `README.md` — Atlas setup, seed, admin usage
- Optional: stop using Postgres progress path when Mongo is primary; keep memory fallback for unit tests

- [ ] **Step 1: Seed production Atlas from YAML.**

- [ ] **Step 2: Set Render env vars; deploy.**

- [ ] **Step 3: Verify `/health`, `/api/problems`, guest progress, admin reload.**

- [ ] **Step 4: Remove filesystem hot-reload in prod paths; keep YAML only for seed/export.**

- [ ] **Step 5: Commit**

```bash
git commit -m "Cut over catalog and progress to MongoDB Atlas."
```

---

## Out of scope (follow-ups)

- Multi-instance cache invalidation (change streams / version counter) — only needed with >1 server.
- Full CMS with golden corpus CI gates (Polygon-style validators) — add before trusting portal edits at scale.
- Migrating historical Postgres rows — production currently falls back to in-memory when `DATABASE_URL` is unset.
- Non-unique-answer checkers (Alien Dictionary, Top K, etc.) — curated equality only for unique outputs.

## Self-review

- Spec coverage: problems+tracks in Mongo, versioning, user progress, sessions, boot cache, admin add+reload, Atlas — each has a task.
- Oracle removed already in this session; plan assumes curated `output` on validation cases.
- Insight key collision and `completedProblemIds` included in Task 5.
- No dual Postgres+Mongo for the same entities after cutover.
