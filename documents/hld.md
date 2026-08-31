# DSA Friend — High-Level Design

This document describes the system as implemented: how a student talks through a
DSA problem, how the server grades that reasoning, and how progress, ranking,
and problem selection work around that loop.

Related notes:

- Open-world evaluation plan: `documents/open-world-approach-evaluation-plan.md`
- Mongo catalog: `documents/mongodb-catalog-design.md`
- Auth: `documents/auth-username-password-design.md`

## 1. Product

DSA Friend is a Socratic practice app. The student explains an approach in
natural language. The system does **not** run submitted code. It grades the
explanation against a versioned **rubric** (problem contract), asks follow-up
probes or at most one hint, then returns a verdict and updates per-topic Elo.

The student never has to match a single canned answer. Known approaches are
fast paths. Unknown-but-plausible approaches go through a guarded LLM evaluator
that can abstain (`plausible_unverified`) instead of rejecting them.

## 2. Goals

- Grade verbal reasoning, not code.
- Treat the rubric as a contract, not an exhaustive answer key.
- Keep scoring, session state, hints, Elo, and mastery in deterministic code.
- Use the LLM only to interpret language, classify insights, or predict how a
  stated algorithm behaves on curated cases.
- Never send expected case outputs to the LLM.
- Ask at most one novel validation challenge per approach.
- Persist catalog, users, sessions, and attempts so progress survives restarts.

## 3. System overview

```text
  Browser (React / Vite)
    Auth · Onboarding · Practice · Roadmap · Profile
           |  cookie reason_uid  (credentials)
           v
  Fastify API  (/api/*)
           |
           +-- AuthService          users (username + bcrypt)
           +-- Catalog cache        published problems + tracks
           +-- SessionStore         live practice session + pinned rubric
           +-- JudgingService       turn loop
           |         |
           |         +-- Layer-1 scans (wrong / alt / tutor intent)
           |         +-- LLM classify  (canonical insight grading)
           |         +-- LLM evaluateApproach  (novel / underspecified)
           |         +-- @reason/core  (state machine, score, evidence gates)
           |
           +-- ProgressService      Elo, mastery, attempts, recommend
           +-- Admin routes         catalog CRUD + reload  (ADMIN_TOKEN)
           |
           v
  MongoDB Atlas  (db: reason)
    problems · rubric_revisions · tracks · users · sessions · attempts

  LLM  (OpenRouter → Gemini → Ollama fallback)
```

### 3.1 Packages

| Package | Role |
| --- | --- |
| `@reason/web` | React UI. Talks only to `/api`. Holds no grading logic. |
| `@reason/server` | Fastify API, Mongo, LLM providers, judging, progress, admin. |
| `@reason/core` | Pure TypeScript: rubric schema, session state machine, scoring, Elo, recommendations, evidence gates. No I/O. |

### 3.2 Runtime dependencies

| Concern | Primary | Fallback |
| --- | --- | --- |
| Auth, catalog, sessions, progress | MongoDB (`MONGODB_URI`) | Auth **requires** Mongo. Catalog can fall back to YAML under `rubrics/` and `tracks/`. Progress can fall back to Postgres (`DATABASE_URL`) then in-memory. Sessions can fall back to in-memory. |
| LLM | OpenRouter (`OPENROUTER_API_KEY`) | Direct Gemini, then Ollama |
| Novel evaluation | `NOVEL_EVALUATION_MODE=off \| shadow \| on` | Default: `off` in production, `shadow` otherwise |

The web SPA is served from `packages/web/dist` by the same Fastify process in
production (Render).

## 4. User journey

Login is required. There is no guest mode.

```text
Register / login
   |
   v
Onboarding (first time): pick skill level
   beginner 800 · intermediate 1100 · advanced 1400 · expert 1700
   optional: two placement problems near that rating
   |
   +-- Practice   start a session, explain, follow-ups, verdict
   +-- Roadmap    Blind-75 track + per-pattern difficulty bands
   +-- Profile    ratings, mastery, attempt history, change level, logout
```

Cookie: httpOnly `reason_uid` = user `_id`, `SameSite=lax`, 1-year max age.
Username is unique case-insensitively (`usernameNormalized`), 3–32 chars
`[a-zA-Z0-9_]`. Password is bcrypt-hashed, min 6 characters.

Every `/api/*` route except register/login/logout requires that cookie.

## 5. Data model (MongoDB)

Database name: `MONGODB_DB` or `reason`.

| Collection | What it stores |
| --- | --- |
| `problems` | Current draft/published body per slug (`_id`). Includes pattern, difficulty, coreAsk, status, `rubricVersion`, full rubric. |
| `rubric_revisions` | Immutable `{problemId, rubricVersion}` snapshots written on publish. |
| `tracks` | Groupings such as Blind-75 (`id`, `title`, `groups[]` of `{slug, title}`). |
| `users` | Auth + progress: username, passwordHash, skillLevel, onboarded, embedded `topics[]`, `completedProblemIds[]`. |
| `sessions` | Live reasoning: pinned rubric snapshot, `context`, turns, idempotency cache. |
| `attempts` | Completed verdicts (one per session). Unbounded history. |

### 5.1 Embedded topic progress (`users.topics[]`)

One row per DSA **pattern** (hashing, two-pointers, trees, …):

- `rating` — per-pattern Elo
- `masteryPercent` — mean of last 5 attempt scores
- `problemsCompleted`, `hintUsage`, `lastPracticedAt`
- `recentPerformance[]` — last 5 scores
- `masteredInsightKeys[]` — `"problemSlug:insightId"` so insight ids do not collide across problems

Derived fields are **not** stored: topic `status` and roadmap `level` are
computed at read time.

### 5.2 Catalog cache

At boot the server loads all **published** problems and tracks into an
in-memory snapshot. `POST /admin/catalog/reload` rebuilds a new snapshot and
swaps it atomically. In-flight sessions keep the rubric they were created with.

YAML under `rubrics/` and `tracks/` is the authoring/seed source
(`packages/server/src/seed-catalog.ts`). After seed, Mongo is the runtime
source of truth.

## 6. Problem contract (rubric)

A rubric is the grading contract for one problem. Schema lives in
`@reason/core` (`RubricSchema`). Example: `rubrics/two-sum-hash-set.yaml`.

| Field | Role |
| --- | --- |
| `problem_id`, `rubric_version`, `pattern` | Identity and topic |
| `difficulty` | Numeric Elo of the problem (opponent rating), e.g. 900 |
| `core_ask` | Problem statement shown to the student |
| `optimal` | Canonical approach, complexity, key insight, sample examples |
| `acceptable_alternatives` | Correct slower/other methods + `match_signals` |
| `common_wrong_approaches` | Known mistakes + `match_signals` + counterexample |
| `required_insights` | Gradable claims with `weight` and a `hints[]` ladder |
| `edge_cases` | Constraints the evaluator must respect |
| `scoring` | Hint penalty and self-correction bonus |
| `validation.cases` | Curated `{id, input, output}` used only by deterministic gates |

**Invariant:** expected `output` values never go to the LLM. The model sees
case **inputs** only and predicts outputs. Code compares predictions to the
authored outputs.

Sessions pin the full rubric document so a later catalog publish does not
change an in-progress attempt.

## 7. End-to-end practice loop

```text
Student picks a problem (Practice list, Roadmap, or recommendation)
   |
   POST /api/sessions  { problemSlug }
   Server creates session: state = AWAIT_APPROACH, insights all "no"
   Client shows core_ask + first sample example
   |
   Student types an explanation
   POST /api/sessions/:id/turns  { message, idempotencyKey }
   |
   JudgingService.handleTurn
     1. Ignore duplicate idempotencyKey
     2. If already VERDICT → LLM clarify (do not re-grade)
     3. Else route the message (see §8)
     4. Deterministic policy picks the next TurnAction
     5. Persist session; if verdict, record attempt + Elo
   |
   Client renders AI message (follow-up, hint, challenge, or verdict card)
   Repeat until verdict, or student asks to reveal
   POST /api/sessions/:id/verdict
```

### 7.1 Session states

| State | Meaning |
| --- | --- |
| `AWAIT_APPROACH` | New session; waiting for the first explanation |
| `FOLLOW_UP` | Probing, hinting, counterexample, or novel challenge in flight |
| `AWAIT_VERDICT` | Insights resolved or hint budget exhausted; student may keep talking or reveal |
| `VERDICT` | Graded. Further messages are clarification only |
| `PITCH` / `COMMITTED` | Reserved in the type; not used by the current loop |

### 7.2 Turn actions

The core state machine (`nextTurnAction` in `@reason/core`) returns one of:

| Action | Who sees it | Effect |
| --- | --- | --- |
| `clarification` | Off-topic, question, sample request, pushback | No grading change |
| `follow_up` | Probe on an unresolved insight or acceptable alt | Increments `probesUsedByInsight`; **not** a hint |
| `hint` | Last ladder step for an insight | Increments `hintsUsed` (max 1 per session) |
| `counterexample` | Known wrong approach matched | Asks the student to walk a failing input |
| `novel_challenge` | Novel path needs one more discriminating detail | At most once; next user message is a challenge answer |
| `verdict_ready` | Ready to score | Asks whether to reveal now |
| `verdict` | Final grade | Score, label, ideal solution, Elo update |

## 8. How a user message is evaluated

Every turn runs a **priority cascade**. The first match wins. Later stages
never run.

```text
latest user message
   |
   v
[1] Deterministic tutor intent
      sample_request  → show the sample, ask them to trace it
      pushback        → "stay with the method you already described"
   |
   v
[2] Deterministic wrong-approach scan
      rubric.common_wrong_approaches.match_signals  (substring, case-insensitive)
      → counterexample action; mark hadWrongApproach
   |
   v
[3] Deterministic acceptable-alternative scan
      rubric.acceptable_alternatives.match_signals
      → one walk-through follow-up, then verdict_ready
   |
   v
[4] Novel evaluator  (only if rubric.validation exists and mode ≠ off)
      shadow: run evaluator for logs, but still take path [5] for the user
      on:     use evaluator outcome as the grade
      off:    skip to [5]
   |
   v
[5] LLM classifier
      JSON: per-insight yes/partial/no + wrong/alt ids + messageKind
      merge insights monotonically (never downgrade yes → no)
      then nextTurnAction
```

### 8.1 Message kinds

Both the classifier and the novel evaluator label the **latest** user message:

| Kind | Meaning | Typical reply |
| --- | --- | --- |
| `approach` | Solution / DS / complexity for this problem | Grade it |
| `question` | "what is the problem?" | Restate `core_ask` + sample |
| `sample_request` | Ask for an example or input | Sample + "trace your approach" |
| `pushback` | "that hint was unrelated" | Stay on their last acceptable method |
| `off_topic` | Chit-chat | Refuse; does not count as a hint |

Layer-1 regexes catch sample_request and pushback without an LLM call.

### 8.2 Canonical classifier path

Used when novel mode is `off`, when the rubric has no `validation` block, in
`shadow` mode (user-visible path), or when the evaluator routes
`known_canonical`.

The LLM is a **grader, not a tutor**. It must quote student evidence per
insight. Missing evidence is `"no"`. `matchedWrongApproach` is always about the
**latest** message (a correction after a wrong approach clears the match).

`mergeInsightResults` is monotonic: `no < partial < yes`. A later turn can
only improve an insight, never take credit away.

`nextTurnAction` then:

1. If every insight is `yes` → `verdict_ready`.
2. If a wrong approach is still matched → `counterexample`.
3. If an acceptable alternative is matched and not yet probed → one `follow_up`;
   after that probe → `verdict_ready`.
4. If `hintsUsed >= MAX_HINTS_PER_SESSION` (1) → `verdict_ready`.
5. Else pick the highest-weight unresolved insight and either probe or reveal
   (see §9).

Self-correction: if the student previously matched a wrong approach and now
sends a clean `approach` message, `selfCorrections` increments (score bonus).

### 8.3 Novel / open-world path

When `NOVEL_EVALUATION_MODE=on` and the rubric has `validation.cases`, one
schema-constrained LLM call (`evaluateApproach`) does routing and prediction
together.

The model returns:

- `route`: `known_canonical` | `novel` | `underspecified`
- `canonicalInsights` (used only on `known_canonical`)
- `approach`: steps, state, invariant, claimed complexity, evidence quotes,
  `criticalGaps`
- `casePredictions`: one predicted output per supplied case **input**
- `recommendation`: `supported` | `refuted` | `challenge`
- optional `challenge` question

`known_canonical` falls back into the classifier policy above (insight merge +
follow-ups). `novel` / `underspecified` **do not** merge canonical insights.
Deterministic `evaluateEvidence` decides the outcome:

| Gate | Fail → |
| --- | --- |
| No `validation` config | `plausible_unverified` |
| Any `criticalGaps` | `plausible_unverified` |
| Not exactly one prediction per case | `plausible_unverified` |
| Predicted output ≠ authored output | `incorrect` (counterexample string) |
| All cases match and no gaps | `acceptable` evidence |

If evidence is `acceptable`, the **label** is `optimal` when claimed time
complexity matches `rubric.optimal.complexity.time`, otherwise `acceptable`.

If evidence is `plausible_unverified` and a challenge string exists and
`novelChallengeUsed` is still false:

- ask `novel_challenge` once
- store `approachModel`
- the **next** user message is evaluated as a challenge answer against the
  prior approach (same approach, not a restart)

If a challenge was already used, or none was proposed, the verdict is
`plausible_unverified`. That label is recorded as an attempt but **does not**
change Elo, mastery, or `completedProblemIds`.

Evaluator failures (invalid JSON after one retry, provider error): abstain
with `plausible_unverified` when mode is `on`. Shadow mode ignores the failure
and uses the classifier.

Results are cached in-process (SHA-256 of rubric version + model + prompt
version + normalized approach + cases + challenge answer; 1000 entries, 24h TTL).

## 9. Follow-ups, hints, and challenges

These are different tools. Only **hints** cost score and Elo.

### 9.1 Probe ladder (`follow_up`)

Each required insight has `hints[]`, ordered from Socratic to explicit.

- Length ≥ 2: the first `N-1` entries are **probes**. They do not increment
  `hintsUsed`.
- The last entry is the **reveal**.
- Length 1: one probe, then the same line is used as the reveal.

`pickNextUnresolvedInsight` chooses the highest-weight insight that is not
yet `yes`. The probe text is prefixed with the first sample example so the
student can trace a concrete input.

Probes are the default Socratic move. The student can answer them across
several turns; insights only move up when the classifier (or canonical
evaluator route) finds evidence.

### 9.2 Hint reveal (`hint`)

A reveal is issued when probes for that insight are exhausted
(`probesUsed >= hints.length - 1`). It increments:

- `hintsUsed` (session total; cap `MAX_HINTS_PER_SESSION = 1`)
- `hintsUsedByInsight[insightId]`

After the one allowed hint, the next classification that does not fully resolve
insights goes to `verdict_ready` rather than another reveal.

Score: `hint_penalty_per_reveal * 100 * hintsUsed` (typically 10 points).
Elo: `hintFactor = max(0.5, 1 - 0.1 * hintsUsed)` shrinks the rating delta.

Off-topic messages are explicitly **not** hints.

### 9.3 Counterexamples

A known wrong approach (layer-1 signal or classifier id) produces a
`counterexample` action: "Walk me through \<input\>. \<why_wrong\>". The
session remembers `hadWrongApproach` so a later correct explanation can earn
the self-correction bonus.

### 9.4 Novel challenge

Separate from the insight ladder. At most **one** extra discriminating
question for an unlisted approach (for example, "do you insert before or after
the complement lookup?"). The answer is merged into the existing
`ApproachModel` and the evidence gates run again. There is no second challenge.

### 9.5 Verdict ready vs reveal

When the machine is done probing, it does not silently grade. It asks whether
the student wants the verdict. The client can call `POST .../verdict` or the
student can keep talking. `revealVerdict` builds the canonical-path verdict
from current insight state (no extra LLM classify call).

After `VERDICT`, further questions go to `llm.clarify`, constrained to the
rubric's optimal solution. The verdict is not rewritten.

## 10. Verdicts and scoring

### 10.1 Labels

| Label | Typical path | Meaning |
| --- | --- | --- |
| `optimal` | All insights `yes`, or novel path with matching complexity | Target solution |
| `acceptable` | All insights yes/partial and no wrong match; or novel path with weaker complexity | Correct but not the target |
| `incomplete` | Canonical path: missing insights | Did not cover the contract |
| `buggy` | Canonical path: wrong approach still matched and hints exhausted | Known mistake |
| `incorrect` | Novel path: curated case mismatch | Stated algorithm fails a case |
| `plausible_unverified` | Novel path: gates not met / evaluator unavailable | Not rejected, not scored for Elo |

### 10.2 Score (0–100)

```text
base   = (earned insight weight / total weight) * 100
         yes = full weight, partial = half, no = 0
score  = clamp(base - hintPenalty + correctionBonus, 0, 100)
```

`hintPenalty = hint_penalty_per_reveal * 100 * hintsUsed`  
`correctionBonus = self_correction_bonus * 100 * selfCorrections`

The verdict also includes the ideal solution (approach, key insight,
complexity, examples) and an `exchanges[]` review of follow-ups / hints /
counterexamples vs the student's answers.

## 11. Ranking, difficulty, mastery, recommendations

### 11.1 Difficulty

Each problem has a numeric `difficulty` on the same scale as Elo (example:
Two Sum hash-set is 900). It is the **opponent rating** in the Elo update.

Difficulty maps to five roadmap **levels**:

| Level | Rating band |
| --- | --- |
| 1 | 800–999 |
| 2 | 1000–1199 |
| 3 | 1200–1399 |
| 4 | 1400–1599 |
| 5 | 1600+ |

Ceilings: 999, 1199, 1399, 1599, ∞. `ratingToLevel` / `difficultyToLevel` use
the same function. Nothing is locked: higher bands are labeled
`above_rating` but remain playable.

### 11.2 Skill level (onboarding)

Sets the **starting** rating for every pattern that has no attempts yet:

| Skill | Starting rating |
| --- | --- |
| beginner | 800 |
| intermediate | 1100 |
| advanced | 1400 |
| expert | 1700 |

Changing skill level later only fills empty topics; it does not rewrite
ratings that already have completions.

### 11.3 Elo (per pattern)

On a rating-eligible verdict:

```text
expected = 1 / (1 + 10^((difficulty - rating) / 400))
actual   = clamp(score / 100, 0, 1)
delta    = round(K * (actual - expected) * hintFactor)
rating   = max(400, rating + delta)
```

`K = 32`. `plausible_unverified` is **not** rating-eligible: attempt is stored,
rating and mastery stay unchanged, problem is not added to
`completedProblemIds`.

Each pattern has its own rating. Hashing Elo does not move trees Elo.

### 11.4 Mastery and topic status

Mastery is the rounded mean of the last **five** scores on that pattern.

| Status | Rule |
| --- | --- |
| `not_started` | Zero completions |
| `needs_review` | Last practice older than 14 days |
| `mastered` | Mastery ≥ 80 |
| `recommended` | Lowest-rated started pattern (server pick) |
| `practicing` | Otherwise |

Newly mastered insights are keys that flipped to `yes` on this attempt and
were not already in `masteredInsightKeys`.

### 11.5 Recommendations

`recommendProblems` scores every catalog problem:

- proximity of `problem.difficulty` to the user's pattern rating
- +25 if the topic `needs_review`, +20 if last practice > 14 days
- +15 if the latest attempt on that pattern scored under 50
- +40 if the client asked for that pattern
- +80 / −20 if the client asked for a specific difficulty
- exclude the problem just completed

Roadmap has two views:

- **Blind-75 style tracks** from `tracks`, with `completed` flags from
  `completedProblemIds`
- **Per-pattern levels** with availability
  `mastered | recommended | available | above_rating`

## 12. LLM usage and the determinism boundary

### 12.1 What the model is allowed to do

| LLM call | When | Output |
| --- | --- | --- |
| `classify` | Canonical / shadow / no validation | Insight statuses, wrong/alt ids, messageKind |
| `evaluateApproach` | Novel mode on/shadow + validation cases | Route, approach model, case predictions, optional challenge |
| `clarify` | After verdict | Short explanation of the **rubric** solution |

Temperature is effectively a best-effort zero. Schema validation (Zod) is
required. Invalid evaluator JSON is retried once, then abstain.

### 12.2 What stays deterministic

- Rubric parse and catalog publish
- Layer-1 signal scans
- Insight merge, probe/hint policy, hint cap
- Curated case expected outputs and evidence gates
- Verdict eligibility, score formula, Elo, mastery, recommendations
- Session state transitions and idempotency

Student text is untrusted. The API never executes model-generated code.
Expected validation outputs are withheld from prompts.

### 12.3 Cost controls

- Known wrong / alt / tutor-intent turns: 0 LLM calls
- Canonical grading: 1 classify call
- Novel resolved in one shot: 1 evaluate call
- Novel + challenge: 2 evaluate calls across two turns, then stop
- Shadow mode is **additive** (evaluator + classifier) and is for metrics only
- In-process evaluation cache keyed by rubric/model/prompt/approach

## 13. HTTP API

Prefix `/api`. Cookie auth unless noted.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/register` | Create user, set cookie |
| POST | `/auth/login` | Authenticate, set cookie |
| POST | `/auth/logout` | Clear cookie |
| GET | `/auth/me` | Current user |
| GET | `/problems` | Catalog (`pattern`, `difficulty` query filters) |
| GET | `/me/progress` | Topics + ratings |
| GET | `/me/roadmap` | Tracks + per-pattern levels |
| GET | `/me/attempts` | History |
| GET | `/me/recommend` | Ranked next problems |
| POST | `/me/skill-level` | Onboard / change starting band |
| POST | `/sessions` | Start practice; returns sample example |
| GET | `/sessions/:id` | Resume transcript + state |
| POST | `/sessions/:id/turns` | Submit explanation (`idempotencyKey` required) |
| POST | `/sessions/:id/verdict` | Reveal when `verdict_ready` |
| GET | `/health` | Liveness (no auth) |

Admin (`ADMIN_TOKEN` bearer; disabled if unset):

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/catalog` | Cached published slugs |
| POST | `/admin/catalog/reload` | Rebuild in-memory snapshot |
| GET | `/admin/problems` | All drafts/published |
| POST | `/admin/problems` | Upsert draft from rubric JSON |
| PUT | `/admin/problems/:id` | Update draft |
| POST | `/admin/problems/:id/publish` | Immutable revision + current pointer |
| PUT | `/admin/tracks` | Replace track documents |

Turns and verdicts are idempotent per session: the same `idempotencyKey`
returns the cached `TurnAction` without a second LLM call or Elo update.

## 14. Reliability and security

- Invalid model JSON: retry once (evaluator), then abstain.
- Provider failure mid-turn: 502, session remains on the last saved state.
- Duplicate verdict persist: unique index on `attempts.sessionId`.
- Catalog reload does not mutate in-flight session rubrics.
- Student text is prompt data, never code.
- Admin routes fail closed without `ADMIN_TOKEN`; they do not share the public
  CORS plugin's trust model beyond bearer comparison (`timingSafeEqual`).
- Do not log passwords; cookies are httpOnly.

## 15. Deployment sketch

GitHub CI runs `pnpm test` and `pnpm build`. Render runs the Fastify server,
which serves the built SPA. Required env: `MONGODB_URI`, an LLM key
(`OPENROUTER_API_KEY` preferred). Optional: `ADMIN_TOKEN`,
`NOVEL_EVALUATION_MODE`, `DATABASE_URL` (legacy progress).

Novel verdicts that change user-visible grades should stay on `off` or
`shadow` until false-accept / false-reject / abstention / cost gates in
`evaluation/two-sum.json` are accepted, then `NOVEL_EVALUATION_MODE=on`.
