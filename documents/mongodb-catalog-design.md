# MongoDB Catalog Design

Status: approved direction for implementation. Details live in
`documents/mongodb-catalog-migration-plan.md`.

## Decisions

1. **Runtime store:** MongoDB Atlas Free (M0) for problems, tracks, users,
   sessions, and attempts.
2. **Authoring (v1):** YAML in git seeds Mongo; admin portal can add/edit/publish
   afterward. Cache reload makes new published problems live without redeploy.
3. **Validation:** Curated case `output` fields only (oracles removed). Expected
   answers never go to the LLM.
4. **Versioning:** Immutable `rubric_revisions`; current `problems` doc points at
   the latest published version. Sessions pin a full rubric snapshot.
5. **Cache:** Load all published problems + tracks at boot; admin
   `POST /admin/catalog/reload` rebuilds and atomically swaps the snapshot.
6. **Auth:** Shared `ADMIN_TOKEN` bearer for `/admin/*`.
7. **Progress:** Embed bounded `topics[]` on the user; store attempts separately;
   key mastered insights as `problemId:insightId`; keep `completedProblemIds` for
   roadmap without scanning all attempts.

## Collections

| Collection | Notes |
| --- | --- |
| `problems` | Current draft/published body per slug |
| `rubric_revisions` | Immutable `{problemId, rubricVersion}` snapshots |
| `tracks` | Blind-75 style groupings |
| `users` | Profile + embedded topics + completedProblemIds |
| `sessions` | Live reasoning state + pinned rubric + turns |
| `attempts` | Completed verdicts (unbounded) |

## Atlas

Org access:
https://cloud.mongodb.com/v2#/org/6a95b2e7fa28f9e43e1183e3/access/users

Env: `MONGODB_URI`, `MONGODB_DB` (default `reason`), `ADMIN_TOKEN`.
