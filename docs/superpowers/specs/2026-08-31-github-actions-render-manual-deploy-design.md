# GitHub Actions CI + manual Render deploy

Date: 2026-08-31

## Goal

Keep continuous integration automatic on every relevant git push. Stop Render from shipping production on push. Production deploys happen only when someone runs a GitHub Actions **Deploy** workflow, which triggers Render via a Deploy Hook for the latest commit on `main`.

## Non-goals

- Polling Render until the service is live (GitHub job green means Render accepted the deploy request).
- Deploying a chosen branch or commit SHA other than Render’s linked `main`.
- Blocking Deploy when CI on `main` is red.
- GitHub environment reviewers / required approvers.
- Storing app secrets (`OPENROUTER_API_KEY`, `MONGODB_URI`, and so on) in GitHub.

## Current state

- `.github/workflows/ci.yml` runs on pull requests and on push to `main`: `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm build`. On push to `main` it also builds the Docker image without pushing it.
- `render.yaml` defines the `dsa-friend` Node web service. Auto-deploy is not set, so Render defaults to deploying on each commit to the linked branch.
- README documents Render as the host and implies a GitHub-connected deploy, not a manual GitHub Actions gate.

## Architecture

```text
git push / PR
        │
        ▼
  GitHub Actions  ci.yml     (automatic)
  test + build
  docker build on main
        │
        │  does NOT deploy
        ▼
  [operator: Actions → Deploy → Run workflow]
        │
        ▼
  GitHub Actions  deploy.yml  (workflow_dispatch only)
  POST Render Deploy Hook
        │
        ▼
  Render builds + starts latest main
  autoDeployTrigger: off
```

CI and CD are separate workflows. CI never calls Render. The Deploy workflow never runs tests; it only asks Render to ship current `main`.

## Components

### CI workflow (unchanged behavior)

File: `.github/workflows/ci.yml`

Triggers: `pull_request` and `push` to `main`. Jobs stay as they are (test/build; Docker build on `main` with `push: false`).

### Deploy workflow (new)

File: `.github/workflows/deploy.yml`

- Trigger: `workflow_dispatch` only. No `push`, `pull_request`, or schedule.
- One job on `ubuntu-latest`.
- Reads GitHub Actions secret `RENDER_DEPLOY_HOOK`.
- `POST`s that URL with `curl --fail --silent --show-error`.
- Fails the job if the secret is empty or Render returns a non-2xx status.

The hook deploys the service’s linked branch (`main` HEAD at request time), not the git ref the workflow file was started from. Operators should run the workflow from `main`; running it from another branch still deploys Render’s `main`.

### Render Blueprint

File: `render.yaml`

Add `autoDeployTrigger: off` on the `dsa-friend` web service. Leave `buildCommand`, `startCommand`, `healthCheckPath`, and env vars unchanged.

After this Blueprint is applied, a git push must not create a new Render deploy.

### Secret

GitHub repository secret `RENDER_DEPLOY_HOOK`: the Deploy Hook URL from the Render dashboard for the `dsa-friend` service (Settings → Deploy Hook). Never commit the URL.

App environment variables stay on Render.

### Docs

Update README Hosting and `documents/hld.md` section 15 so operators know: CI is automatic; production updates only via Actions → Deploy → Run workflow; one-time steps are create the hook, add the secret, and apply the Blueprint (or turn Auto-Deploy off in the dashboard if the service already exists).

## Data flow

1. Push or PR → CI runs → Render does not deploy.
2. Operator opens GitHub Actions → Deploy → Run workflow (intended from `main`).
3. Job POSTs `RENDER_DEPLOY_HOOK`.
4. Render queues a deploy of linked `main`, runs the existing Blueprint build/start, checks `/health`.
5. Operator confirms the live site in the Render dashboard if they need deploy-success (not only request-accepted) status.

## Error handling

| Situation | Behavior |
| --- | --- |
| `RENDER_DEPLOY_HOOK` unset or empty | Job fails immediately; no HTTP request. |
| Hook returns 4xx/5xx | `curl --fail` fails the GitHub run. No retry loop; re-run the workflow. |
| GitHub job green, Render build/start fails | Possible. Operator checks Render deploy logs. v1 does not poll. |
| Existing Render service still has Auto-Deploy on | Pushes would still ship until Blueprint sync or dashboard toggle. Docs must include this one-time step. |
| Workflow started from a non-`main` branch | Hook still deploys Render’s linked `main`. Document; no SHA input. |

## Verification

- Open a PR or push to `main`: existing CI still runs.
- After merge to `main`, Render does not start a new deploy until Deploy is run.
- Run Deploy with the secret set: GitHub job succeeds; Render starts a deploy of that `main` HEAD; `/health` is OK after Render finishes.
- README Hosting matches the operator steps.

No new unit tests. No change to `pnpm test` or the Docker CI job.

## Implementation notes (for the later plan)

- Use `autoDeployTrigger: off` (current Blueprint field). Do not add deprecated `autoDeploy: false` as the primary setting.
- Keep deploy.yml to a single POST step plus a missing-secret check. Do not add Render API keys, service IDs, or wait-for-live loops in v1.
- Do not commit `.env`, hook URLs, or `.vscode/`.
