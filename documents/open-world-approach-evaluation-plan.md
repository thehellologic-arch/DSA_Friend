# Open-World Approach Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely evaluate novel verbal DSA approaches without treating the rubric as an exhaustive solution allowlist.

**Architecture:** Preserve deterministic fast paths for known wrong and accepted approaches. Route unmatched approaches through one schema-constrained interpretation/evaluation call, compare its case predictions with deterministic oracles, and ask at most one challenge before returning either a supported verdict or `plausible_unverified`.

**Tech Stack:** TypeScript, Zod, Vitest, Fastify, YAML rubrics, existing OpenRouter/Gemini/Ollama providers.

## Global Constraints

- Verbal explanations remain valid input; pseudocode or runnable code is not mandatory.
- Unknown approaches must never be rejected merely because they are absent from a rubric.
- Expected case outputs must come from curated data or deterministic oracles, never from an LLM.
- The LLM may interpret claims and predict behavior, but deterministic policy owns verdict eligibility and Elo.
- Ask no more than one novel-approach validation challenge per session approach.
- `plausible_unverified` does not update Elo or mastery.
- Keep existing known-approach behavior working during gradual rollout.
- Record LLM token usage and route so the cost impact is measurable.

## Chosen Approach

Use a challenge-based hybrid evaluator:

1. Keep deterministic intent, known-wrong, and known-alternative scans.
2. Treat an unmatched approach as `novel`, not `wrong`.
3. Use one LLM call to extract a structured approach, quote evidence, predict
   behavior on selected cases, and identify one critical ambiguity.
4. Compare predicted results with an oracle in deterministic code.
5. If all evidence gates pass, issue `optimal` or `acceptable`.
6. If a counterexample is demonstrated, issue `incorrect`.
7. Otherwise ask one targeted challenge and re-evaluate once.
8. If uncertainty remains, issue `plausible_unverified`.

See `documents/hld.md` for component boundaries and the complete cost model.

## LLM Cost Impact

Known local matches remain at zero LLM calls. A known approach that currently
uses one classifier call continues to use one call, with a somewhat larger
structured payload. A novel approach normally uses one evaluator call; a novel
approach needing clarification uses one additional call on the next turn.

Expected directional impact:

- known local path: no change;
- known classified path: approximately 1.2–1.6× tokens per evaluated turn;
- novel path resolved immediately: approximately 1.2–1.8× current token cost;
- novel path with challenge: approximately 2–3× current cost for that attempt;
- maximum evaluation calls for one novel approach: two.

The implementation must measure real prompt tokens, completion tokens, latency,
route, provider, model, and cache status before any budget threshold is chosen.

---

### Task 1: Add Open-World Evaluation Domain Types

**Files:**
- Modify: `packages/core/src/rubric.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/index.test.ts`

**Interfaces:**
- Produces: `ApproachModelSchema`, `ApproachEvaluationSchema`,
  `ValidationConfigSchema`, `ValidationOutcome`, and corresponding TypeScript
  types.
- Consumes: existing `RubricSchema`, `ClassifyResultSchema`, and verdict types.

- [ ] **Step 1: Write failing schema tests**

Add tests that parse:

```ts
const approach = ApproachModelSchema.parse({
  steps: ["sort ascending", "move two pointers based on the sum"],
  state: ["left index", "right index"],
  invariant: "No discarded outside pair can reach the target",
  claimedComplexity: { time: "O(n log n)", space: "O(1)" },
  assumptions: ["sorting a copy is allowed"],
  evidence: [
    { claim: "sort ascending", quote: "I will sort the array" },
  ],
  criticalGaps: [],
});

expect(approach.steps).toHaveLength(2);
```

Also assert that `ValidationConfigSchema` accepts structured cases and rejects
a case with no `id` or `input`.

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
pnpm --filter @reason/core test
```

Expected: FAIL because the new schemas are not exported.

- [ ] **Step 3: Add schemas and types**

Add these contracts to `packages/core/src/rubric.ts`:

```ts
export const ApproachModelSchema = z.object({
  steps: z.array(z.string()),
  state: z.array(z.string()),
  invariant: z.string().nullable(),
  claimedComplexity: z
    .object({ time: z.string().nullable(), space: z.string().nullable() })
    .nullable(),
  assumptions: z.array(z.string()),
  evidence: z.array(z.object({ claim: z.string(), quote: z.string() })),
  criticalGaps: z.array(z.string()),
});

export const ValidationConfigSchema = z.object({
  oracle: z.string(),
  cases: z.array(
    z.object({
      id: z.string(),
      input: z.unknown(),
      tags: z.array(z.string()).default([]),
    }),
  ),
});

export const ApproachEvaluationSchema = z.object({
  messageKind: MessageKindSchema,
  route: z.enum(["known_canonical", "novel", "underspecified"]),
  canonicalInsights: z.array(
    z.object({
      id: z.string(),
      status: InsightStatusSchema,
      evidence: z.string().nullable(),
    }),
  ),
  approach: ApproachModelSchema,
  casePredictions: z.array(
    z.object({ caseId: z.string(), output: z.unknown(), reasoning: z.string() }),
  ),
  recommendation: z.enum(["supported", "refuted", "challenge"]),
  challenge: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export type ValidationOutcome =
  | { status: "optimal" | "acceptable"; evidence: string[] }
  | { status: "incorrect"; counterexample: string }
  | { status: "plausible_unverified"; reason: string };
```

Add `validation: ValidationConfigSchema.optional()` to `RubricSchema` and
export all new contracts from `packages/core/src/index.ts`.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter @reason/core test
```

Expected: PASS.

- [ ] **Step 5: Commit the domain contracts**

```bash
git add packages/core/src/rubric.ts packages/core/src/index.ts packages/core/src/index.test.ts
git commit -m "Add open-world evaluation contracts."
```

---

### Task 2: Implement Deterministic Oracles and Evidence Gates

**Files:**
- Create: `packages/core/src/oracles.ts`
- Create: `packages/core/src/approach-validation.ts`
- Create: `packages/core/src/approach-validation.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `runOracle(oracleId: string, input: unknown): unknown`.
- Produces: `evaluateEvidence(rubric, evaluation): ValidationOutcome`.
- Consumes: `Rubric`, `ApproachEvaluation`, and `ValidationOutcome`.

- [ ] **Step 1: Write failing oracle and policy tests**

Cover Two Sum duplicate, no-solution, and negative-number cases:

```ts
expect(
  runOracle("two_sum_exists", { numbers: [3, 3], target: 6 }),
).toBe(true);

expect(
  runOracle("two_sum_exists", { numbers: [1, 2, 4], target: 8 }),
).toBe(false);
```

Add evidence-policy tests proving:

- matching predictions and no critical gaps can be supported;
- one mismatched prediction returns `incorrect`;
- missing predictions or critical gaps return `plausible_unverified`;
- evaluator confidence alone cannot override a failed gate.

- [ ] **Step 2: Verify tests fail**

Run:

```bash
pnpm --filter @reason/core test
```

Expected: FAIL because oracle and policy modules do not exist.

- [ ] **Step 3: Implement the Two Sum oracle registry**

Use an explicit registry and reject unknown IDs:

```ts
type Oracle = (input: unknown) => unknown;

const oracles: Record<string, Oracle> = {
  two_sum_exists(input) {
    const parsed = z
      .object({ numbers: z.array(z.number()), target: z.number() })
      .parse(input);
    const seen = new Set<number>();
    for (const value of parsed.numbers) {
      if (seen.has(parsed.target - value)) return true;
      seen.add(value);
    }
    return false;
  },
};

export function runOracle(oracleId: string, input: unknown): unknown {
  const oracle = oracles[oracleId];
  if (!oracle) throw new Error(`Unknown validation oracle: ${oracleId}`);
  return oracle(input);
}
```

- [ ] **Step 4: Implement deterministic evidence gates**

`evaluateEvidence` must:

1. return unverified when validation config is missing;
2. return unverified when `criticalGaps` is non-empty;
3. require exactly one prediction for every supplied case;
4. compare normalized prediction output with `runOracle`;
5. return the first mismatching case as a concrete counterexample;
6. return supported evidence only when every gate passes.

Do not use `evaluation.confidence` as a bypass.

- [ ] **Step 5: Run core tests and build**

```bash
pnpm --filter @reason/core test
pnpm --filter @reason/core build
```

Expected: both commands PASS.

- [ ] **Step 6: Commit deterministic validation**

```bash
git add packages/core/src/oracles.ts packages/core/src/approach-validation.ts packages/core/src/approach-validation.test.ts packages/core/src/index.ts
git commit -m "Validate approach evidence with deterministic oracles."
```

---

### Task 3: Add Two Sum Validation Contract

**Files:**
- Modify: `rubrics/two-sum-hash-set.yaml`
- Modify: `packages/server/src/rubric-store.ts`
- Test: `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: optional `validation` rubric schema from Task 1.
- Produces: a pilot contract using oracle ID `two_sum_exists`.

- [ ] **Step 1: Add a failing rubric parsing test**

Load a fixture with:

```yaml
validation:
  oracle: two_sum_exists
  cases:
    - id: basic_match
      input: { numbers: [2, 7, 11, 15], target: 9 }
      tags: [basic]
    - id: duplicate_match
      input: { numbers: [3, 3], target: 6 }
      tags: [duplicates, distinct_indices]
    - id: no_match
      input: { numbers: [1, 2, 4], target: 8 }
      tags: [negative_result]
```

Assert that all three cases survive `parseRubric`.

- [ ] **Step 2: Verify the test fails before fixture changes**

```bash
pnpm --filter @reason/core test
```

Expected: FAIL because the fixture has no validation contract.

- [ ] **Step 3: Add the contract to the Two Sum rubric**

Add the exact YAML above to `rubrics/two-sum-hash-set.yaml`. Keep the current
optimal, alternative, wrong-approach, and hint content unchanged.

- [ ] **Step 4: Validate all rubrics and build the server**

```bash
pnpm --filter @reason/core test
pnpm --filter @reason/core build
pnpm --filter @reason/server build
```

Expected: all commands PASS and all rubrics load.

- [ ] **Step 5: Commit the pilot contract**

```bash
git add rubrics/two-sum-hash-set.yaml packages/core/src/index.test.ts
git commit -m "Add Two Sum novel-approach validation cases."
```

---

### Task 4: Add One-Call Combined Approach Evaluator

**Files:**
- Create: `packages/server/src/approach-evaluation-prompt.ts`
- Create: `packages/server/src/approach-evaluator.ts`
- Create: `packages/server/src/approach-evaluator.test.ts`
- Modify: `packages/server/src/ollama-provider.ts`
- Modify: `packages/server/src/openai-provider.ts`
- Modify: `packages/server/src/gemini-provider.ts`

**Interfaces:**
- Produces:
  `evaluateApproach(input: ApproachEvaluationRequest): Promise<ApproachEvaluation>`.
- `ApproachEvaluationRequest` includes the core ask, constraints, selected cases
  without expected outputs, prior `ApproachModel`, challenge answer, and
  relevant transcript quotes.
- Consumes: `ApproachEvaluationSchema`.

- [ ] **Step 1: Write provider-independent evaluator tests**

Use a fake completion function and assert:

- only case IDs and inputs are sent, not oracle outputs;
- direct evidence quotes are required;
- invalid JSON retries once;
- a second invalid result throws `ApproachEvaluationUnavailableError`;
- unrelated transcript history is excluded;
- an existing approach model and challenge answer are included on the second
  evaluation.

- [ ] **Step 2: Verify tests fail**

```bash
pnpm --filter @reason/server build
```

Expected: FAIL because the evaluator module does not exist.

- [ ] **Step 3: Implement a shared prompt**

The system prompt must state:

```text
First route the approach as known_canonical, novel, or underspecified. Grade
canonical insights when applicable. Interpret only the student's stated
algorithm and do not complete missing steps.
Every supported claim must quote the student. Predict the stated algorithm's
output for each supplied case. The expected outputs are intentionally hidden.
Return only JSON matching the supplied schema. Unknown or missing behavior is
a critical gap, not permission to assume the canonical solution.
```

Return one combined interpretation/evaluation response to avoid separate
interpreter and critic calls.

- [ ] **Step 4: Add provider methods**

Add `evaluateApproach` to the existing `LLMProvider` contract and implement
it in OpenAI/OpenRouter, Gemini, and Ollama providers using the shared prompt
and `ApproachEvaluationSchema`.

Provider responses must also return usage when available:

```ts
interface LlmUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}
```

- [ ] **Step 5: Run server and core verification**

```bash
pnpm --filter @reason/core test
pnpm --filter @reason/core build
pnpm --filter @reason/server build
```

Expected: all commands PASS.

- [ ] **Step 6: Commit the evaluator**

```bash
git add packages/server/src/approach-evaluation-prompt.ts packages/server/src/approach-evaluator.ts packages/server/src/approach-evaluator.test.ts packages/server/src/ollama-provider.ts packages/server/src/openai-provider.ts packages/server/src/gemini-provider.ts
git commit -m "Evaluate novel verbal approaches in one structured call."
```

---

### Task 5: Integrate Novel Routing and One-Challenge State

**Files:**
- Modify: `packages/core/src/rubric.ts`
- Modify: `packages/core/src/reasoning-core.ts`
- Modify: `packages/server/src/session-store.ts`
- Modify: `packages/server/src/judging-service.ts`
- Modify: `packages/core/src/index.test.ts`
- Create: `packages/server/src/judging-service.test.ts`

**Interfaces:**
- Adds session fields:
  `approachModel`, `novelChallengeUsed`, and `pendingNovelChallenge`.
- Produces turn action `novel_challenge`.
- Produces verdict label `plausible_unverified`.
- Consumes evaluator and deterministic evidence policy from earlier tasks.

- [ ] **Step 1: Write failing routing tests**

Test these complete flows:

1. known alternative remains on the deterministic path;
2. unmatched approach with enabled validation invokes the novel evaluator;
3. supported evidence creates an acceptable or optimal verdict;
4. mismatched prediction creates an incorrect verdict with the failing case;
5. incomplete evidence asks one challenge;
6. a challenge answer updates the same approach model;
7. continued ambiguity produces `plausible_unverified`;
8. no second challenge is issued;
9. a rubric without validation uses the existing behavior.

- [ ] **Step 2: Verify tests fail**

```bash
pnpm --filter @reason/core test
pnpm --filter @reason/server build
```

Expected: FAIL because novel session state and actions are absent.

- [ ] **Step 3: Add session and action contracts**

Initialize:

```ts
approachModel: null,
novelChallengeUsed: false,
pendingNovelChallenge: null,
```

Add a `novel_challenge` action carrying only the challenge text. Ensure it does
not increment `hintsUsed` or canonical insight probes.

- [ ] **Step 4: Implement routing in `JudgingService`**

Use this order:

```text
intent
known wrong
known acceptable
pending novel challenge answer
combined approach evaluation
```

The combined evaluator classifies `messageKind` in the same call. Off-topic
messages, sample requests, and pushback return the existing clarification path
without applying novel evidence gates.

For validation-enabled rubrics, the combined evaluator replaces the current
classifier after local fast paths. A `known_canonical` route merges
`canonicalInsights`; a `novel` route applies oracle evidence gates. Do not call
the old classifier followed by the evaluator, because that doubles LLM cost.
Rubrics without validation continue using the existing classifier.

- [ ] **Step 5: Apply deterministic verdict policy**

Map supported evidence to:

- `optimal` when the approach's supported complexity meets the rubric target;
- `acceptable` when correctness gates pass but complexity is worse or unknown;
- `incorrect` on a concrete mismatch;
- `plausible_unverified` after the challenge remains inconclusive.

Do not update canonical insight status merely because the novel method is
correct.

- [ ] **Step 6: Run tests and builds**

```bash
pnpm test
pnpm build
```

Expected: all tests and workspace builds PASS.

- [ ] **Step 7: Commit integration**

```bash
git add packages/core/src/rubric.ts packages/core/src/reasoning-core.ts packages/core/src/index.test.ts packages/server/src/session-store.ts packages/server/src/judging-service.ts packages/server/src/judging-service.test.ts
git commit -m "Route unknown approaches through guarded validation."
```

---

### Task 6: Protect Elo and Surface Unverified Results

**Files:**
- Modify: `packages/server/src/progress-service.ts`
- Modify: `packages/web/src/api.ts`
- Modify: `packages/web/src/screens/PracticeScreen.tsx`
- Modify: `packages/web/src/index.css`
- Create: `packages/server/src/progress-service.test.ts`

**Interfaces:**
- Consumes verdict label `plausible_unverified`.
- Produces API fields `validationStatus`, `validationEvidence`, and
  `ratingEligible`.

- [ ] **Step 1: Write failing rating-policy tests**

Assert that:

- `plausible_unverified` records the attempt;
- rating and mastery remain unchanged;
- `optimal`, `acceptable`, and evidence-backed `incorrect` remain eligible;
- the response explicitly reports `ratingEligible: false` for uncertainty.

- [ ] **Step 2: Verify test failure**

```bash
pnpm --filter @reason/server build
```

Expected: FAIL until the new verdict label is handled.

- [ ] **Step 3: Implement progress protection**

Return early from rating mutation when:

```ts
if (verdict.label === "plausible_unverified") {
  return {
    ...attemptResult,
    ratingEligible: false,
    ratingDelta: 0,
  };
}
```

Persist the attempt and evidence before returning.

- [ ] **Step 4: Add concise UI treatment**

Display:

```text
Plausible, but not verified
No rating change. The verbal explanation did not provide enough evidence for a
definitive verdict.
```

Show the unresolved assumption and challenge evidence without displaying raw
provider output.

- [ ] **Step 5: Run verification**

```bash
pnpm test
pnpm build
```

Expected: PASS.

- [ ] **Step 6: Commit rating and UI behavior**

```bash
git add packages/server/src/progress-service.ts packages/server/src/progress-service.test.ts packages/web/src/api.ts packages/web/src/screens/PracticeScreen.tsx packages/web/src/index.css
git commit -m "Keep uncertain evaluations out of ratings."
```

---

### Task 7: Add Cost Telemetry, Cache, and Shadow Rollout

**Files:**
- Create: `packages/server/src/evaluation-metrics.ts`
- Create: `packages/server/src/evaluation-cache.ts`
- Create: `packages/server/src/evaluation-cache.test.ts`
- Modify: `packages/server/src/judging-service.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces a cache key from rubric version, model, prompt version, normalized
  approach model, selected cases, and challenge answer.
- Produces structured metrics:
  `route`, `model`, `promptTokens`, `completionTokens`, `latencyMs`,
  `cacheHit`, `challengeUsed`, and `outcome`.
- Consumes environment flag `NOVEL_EVALUATION_MODE=off|shadow|on`.

- [ ] **Step 1: Write failing cache tests**

Assert:

- identical normalized input returns the same key;
- rubric, model, or prompt version changes invalidate the key;
- challenge answers do not collide with first-pass evaluations;
- cached invalid schema output is never reused.

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @reason/server build
```

Expected: FAIL because cache and metrics modules do not exist.

- [ ] **Step 3: Implement bounded cache**

Use an in-memory TTL cache for the pilot. Store only successfully parsed
`ApproachEvaluation` values. Set:

```ts
const MAX_ENTRIES = 1000;
const TTL_MS = 24 * 60 * 60 * 1000;
```

Hash the canonical JSON key with SHA-256 so raw student text is not used as a
map key or log field.

- [ ] **Step 4: Add structured metrics**

Log one event per evaluation without full student text:

```ts
logger.info({
  event: "novel_approach_evaluation",
  route,
  model,
  promptTokens,
  completionTokens,
  latencyMs,
  cacheHit,
  challengeUsed,
  outcome,
});
```

- [ ] **Step 5: Add rollout modes**

- `off`: preserve current behavior;
- `shadow`: run and record evaluation but return the existing user experience;
- `on`: use the new verdict and challenge behavior.

Default local development to `shadow`; keep production `off` until explicitly
configured.

- [ ] **Step 6: Run full verification**

```bash
pnpm test
pnpm build
```

Expected: PASS.

- [ ] **Step 7: Commit observability and rollout controls**

```bash
git add packages/server/src/evaluation-metrics.ts packages/server/src/evaluation-cache.ts packages/server/src/evaluation-cache.test.ts packages/server/src/judging-service.ts packages/server/src/index.ts .env.example
git commit -m "Measure and gate novel evaluation rollout."
```

---

### Task 8: Build the Golden Evaluation Corpus

**Files:**
- Create: `evaluation/two-sum.json`
- Create: `packages/server/src/novel-evaluation-golden.test.ts`
- Modify: `README.md`

**Interfaces:**
- Produces expert-reviewed examples labeled `optimal`, `acceptable`,
  `incorrect`, or `plausible_unverified`.
- Consumes shadow evaluator output and deterministic evidence policy.

- [ ] **Step 1: Add the initial corpus**

Include at least:

- canonical hash-set explanation;
- sorting plus two pointers;
- sorting plus binary search;
- brute force with correct complexity;
- reuse of one element;
- duplicate-safe and duplicate-unsafe variants;
- underspecified “use a map”;
- correct novel paraphrases;
- irrelevant text;
- correction after one challenge.

Each record must contain input text, optional prior turns, expected route,
expected outcome, and expert rationale.

- [ ] **Step 2: Add a deterministic golden test harness**

The test must validate routing and evidence-policy output using recorded,
schema-valid evaluator fixtures. It must not call a paid provider during unit
tests.

- [ ] **Step 3: Document manual shadow review**

Add commands and required metrics to `README.md`:

```bash
NOVEL_EVALUATION_MODE=shadow pnpm dev
pnpm test
```

Document the release gate: review false acceptances, false rejections,
abstentions, average tokens, p95 latency, and challenge rate before enabling
`on`.

- [ ] **Step 4: Run final verification**

```bash
pnpm test
pnpm build
git status --short
```

Expected: tests/build PASS; status contains only intended implementation files.

- [ ] **Step 5: Commit corpus and documentation**

```bash
git add evaluation/two-sum.json packages/server/src/novel-evaluation-golden.test.ts README.md
git commit -m "Add a golden corpus for novel approach evaluation."
```

## Acceptance Criteria

- Unknown approaches route to novel evaluation rather than canonical hints.
- The evaluator never receives expected case outputs.
- Deterministic oracles and gates decide whether a verdict is eligible.
- One novel approach can cause at most two evaluation calls.
- Continued ambiguity becomes `plausible_unverified`.
- Unverified attempts cannot change Elo or mastery.
- Known paths remain behaviorally compatible.
- Cost and latency are measurable by route and model.
- Two Sum passes the expert-reviewed pilot corpus.
