# DSA Friend Open-World Evaluation — High-Level Design

## Context

The current grader compares a student's explanation with known insights,
acceptable alternatives, and wrong approaches stored in a rubric. That works
for known answers but creates a closed-world assumption: an approach that is
not listed can be treated as incomplete even when it is valid.

The new design makes the rubric a **problem contract**, not an exhaustive
answer list. Known approaches remain deterministic fast paths. Novel verbal
approaches enter a guarded LLM evaluation path that can abstain.

## Goals

- Evaluate correct approaches that were not anticipated in the rubric.
- Never reject an approach merely because it is unknown.
- Keep deterministic code responsible for state, scoring, and Elo.
- Use LLMs only to interpret verbal reasoning and select a challenge.
- Expose uncertainty as `plausible_unverified`.
- Ask at most one validation challenge per approach.

## System Context

```text
Student
   |
   v
Practice API
   |
   v
Judging Service
   +-------------------- known approach --------------------+
   |                                                        |
   v                                                        v
Approach Interpreter                                Deterministic Engine
   |                                                        |
   v                                                        |
Novelty Router ---------------------------------------------+
   |
   v
Novel Approach Evaluator <---- Problem Contract / Oracle
   |
   +---- enough evidence ----------> Verdict Policy
   |
   +---- insufficient evidence ----> One Challenge Question
                                          |
                                          v
                                  Re-evaluate Same Approach
```

## Components

### Problem Contract

An enabled rubric supplies:

- input/output semantics and constraints;
- canonical complexity target;
- curated examples and counterexamples;
- known approaches and known failure modes;
- deterministic oracle identifier.

The oracle computes expected outputs. It does not determine whether a vague
verbal description faithfully implements an algorithm.

### Approach Interpreter

The interpreter converts the student's conversation into structured claims:

- ordered steps;
- state and data structures;
- decision rules;
- invariant;
- complexity claim;
- assumptions;
- direct evidence quotes;
- missing details.

It must distinguish student-supported claims from model inference. Inferred
details cannot satisfy an evidence gate.

### Novelty Router

The router returns:

- `known_valid`;
- `known_wrong`;
- `novel`;
- `underspecified`.

Unknown is never synonymous with incorrect.

### Combined Approach Evaluator

For any approach not caught by a local fast path, one schema-constrained LLM
call:

1. routes it as canonical, novel, or underspecified;
2. grades canonical rubric insights when applicable;
3. interprets a novel approach;
4. checks internal consistency;
5. predicts behavior on curated cases;
6. identifies the highest-risk missing assumption;
7. recommends either a verdict or one challenge.

Expected case outputs come from curated data or deterministic oracles. The LLM
cannot create its own answer key.

### Challenge Manager

The manager asks at most one discriminating question. The response updates the
same `ApproachModel`; it does not restart classification. If evidence remains
insufficient after that answer, the outcome is `plausible_unverified`.

### Verdict Policy

Supported outcomes:

- `optimal`;
- `acceptable`;
- `incorrect`;
- `plausible_unverified`.

A scored verdict requires all evidence gates:

1. no unresolved correctness-critical step;
2. consistency on selected curated cases;
3. no discovered adversarial counterexample;
4. a consistent answer to the challenge when one was required.

Correctness and efficiency are evaluated separately. Only sufficiently
supported `optimal`, `acceptable`, and `incorrect` outcomes update Elo.

## Data Flow

1. Receive the latest student message and session state.
2. Run deterministic intent and known-wrong scans.
3. Match locally recognizable valid approaches.
4. Send remaining approach text to the combined evaluator, which classifies
   canonical insight evidence or routes it to novel validation in the same
   call.
5. Validate its structured output against a strict schema.
6. Independently obtain expected outputs from the problem oracle.
7. Apply deterministic evidence gates.
8. Return a verdict or one targeted challenge.
9. Merge the answer into the existing approach model and evaluate once more.
10. Persist evidence, confidence, model version, rubric version, and cost data.

## Determinism Boundary

Deterministic:

- rubric parsing;
- known approach matching;
- oracle outputs;
- evidence-gate policy;
- session state transitions;
- hint limits;
- verdict eligibility;
- Elo and mastery updates.

Non-deterministic:

- interpreting natural-language algorithm steps;
- predicting how underspecified prose behaves;
- choosing the best challenge.

Temperature `0` reduces variation but does not guarantee identical output.
Schema validation, evidence quotes, caching, abstention, and deterministic
policy limit the effect of model variability.

## LLM Cost Impact

### Per-turn behavior

| Path | Current | Proposed | Expected impact |
| --- | ---: | ---: | --- |
| Known wrong/alternative caught locally | 0 calls | 0 calls | No change |
| Known approach requiring classification | 1 call | 1 call | Similar; structured prompt may use 20–60% more tokens |
| Novel approach resolved immediately | 1 call | 1 evaluation call | Usually 1.2–1.8× token cost |
| Novel approach needing challenge | 1 call | 2 total calls across two turns | Usually 2–3× token cost for that attempt |
| Uncertain after challenge | Variable today | 2 calls, then abstain | Bounded maximum |

These are architecture estimates, not provider prices. Actual cost depends on
the configured model, prompt size, response size, cache hits, and percentage of
novel approaches.

Let:

- `K` be evaluated known-approach turns;
- `N` be evaluated novel-approach turns;
- `q` be the fraction of novel approaches requiring a challenge;
- `C` be the average cost of one current classifier call;
- `E` be the average cost of one structured evaluator call.

The approximate evaluation cost is:

```text
current  = (K + N) * C
proposed = K * C + N * E + N * q * E
```

Cost controls:

- keep known cases on deterministic fast paths;
- use one combined interpreter/evaluator call;
- make the second call conditional;
- cap validation at one challenge;
- send only the current approach summary and relevant cases;
- cache by rubric version, model version, and normalized approach;
- use a smaller model for extraction and escalate only when calibrated data
  demonstrates a benefit;
- record prompt tokens, completion tokens, latency, route, and cache status.

## Reliability and Failure Handling

- Invalid model JSON: retry once, then abstain.
- Unsupported or contradictory claims: ask the single challenge or abstain.
- Concrete counterexample: return `incorrect` with its trace.
- Missing oracle: known paths may proceed; novel paths abstain.
- Model/provider failure: preserve session state and return a retryable result.
- Unstable repeated evaluation: do not vote a definitive answer; abstain.

## Rollout

1. Implement Two Sum and a small structurally diverse pilot set.
2. Run the evaluator in shadow mode without changing user-visible verdicts.
3. Compare outcomes with an expert-reviewed corpus.
4. Track false acceptance, false rejection, abstention, latency, and cost.
5. Enable novel verdicts only after meeting agreed reliability and budget
   thresholds.

## Security and Privacy

- Treat all student text as untrusted data.
- Use role separation and schema-constrained output.
- Never execute model-generated code in the API process.
- Redact secrets and avoid sending unrelated transcript history.
- Version and audit evaluator prompts and model configuration.
