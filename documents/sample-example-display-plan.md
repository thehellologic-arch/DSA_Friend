# Practice Sample Example Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the first curated rubric example, including input, output, and explanation, in every active practice session.

**Architecture:** Make rubric examples non-empty and mandatory at the core schema boundary. Return the first example from session creation, type it in the web API client, and render it as a compact block beneath the core question.

**Tech Stack:** TypeScript, Zod, Vitest, Fastify, React, CSS.

## Global Constraints

- Samples come only from `rubric.optimal.examples`; the LLM does not generate them.
- Every rubric must contain at least one non-empty input, output, and explanation.
- The active practice card shows input, output, and explanation.
- Existing transcript, hint, and answer behavior remains unchanged.

---

### Task 1: Require Complete Rubric Examples

**Files:**
- Modify: `packages/core/src/rubric.ts`
- Modify: `packages/core/src/index.test.ts`

**Interfaces:**
- Consumes: `RubricSchema` and `parseRubric`.
- Produces: required `optimal.examples` with at least one complete example.

- [ ] Add failing tests that reject a rubric with no examples and one with an empty input.
- [ ] Run `pnpm --filter @reason/core test`; expect both new tests to fail.
- [ ] Change each example field to `z.string().min(1)` and the examples array to `.min(1)` without `.optional()`.
- [ ] Run `pnpm --filter @reason/core test`; expect all tests to pass.

### Task 2: Return and Render the First Example

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/web/src/api.ts`
- Modify: `packages/web/src/screens/PracticeScreen.tsx`
- Modify: `packages/web/src/index.css`

**Interfaces:**
- Produces: `SessionStart.sampleExample: { input: string; output: string; explanation: string }`.
- Consumes: `rubric.optimal.examples[0]`.

- [ ] Add `sampleExample` to the session creation response.
- [ ] Add the same required object to `SessionStart`.
- [ ] Render an `EXAMPLE` section after `session.coreAsk` with labeled input, output, and explanation.
- [ ] Add compact responsive styles with wrapping for long values.
- [ ] Run `pnpm test && pnpm build`; expect both commands to pass.
- [ ] Start a Longest Consecutive Sequence session and verify its API sample is `[100,4,200,1,3,2]`, output `4`, with the curated explanation.
- [ ] Commit, push `main`, deploy that commit to Render, and verify `/health`, `/api/problems`, and the session API.
