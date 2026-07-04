# @shipfox/e2e-platform-workflows

End-to-end tests where each case is a real workflow YAML run through the whole
platform: a gitea push, the org webhook, definition sync, trigger dispatch, Temporal
orchestration, a local source runner, step execution, and log capture. The suite
asserts only on the public observation APIs (`/workflows/runs`, `/workflows/runs/:id`,
and the step logs route).

## How a scenario works

A scenario is a directory under `scenarios/`:

```
scenarios/hello-world/
  workflow.yml    pushed verbatim to .shipfox/workflows/hello-world.yml
  expect.yaml     declarative expectations (run/job/step status, job status reason, step error, exit code, logs)
  reject.yaml     alternative to expect.yaml for authoring-time rejection scenarios
  secrets.yaml    optional E2E setup secrets to seed before the run
  files/          optional extra repo files, committed alongside the workflow
```

`tests/scenarios.e2e.ts` discovers every directory that contains an `expect.yaml` or
`reject.yaml` and registers one Playwright test for it. Each `expect.yaml` test,
against the shared suite arrangement:

1. creates a fresh gitea repo and a project bound to it,
2. seeds the workflow (and any `files/`) in one commit, then waits for the definition
   to resolve (this closes the sync/dispatch race),
3. starts a local `@shipfox/runner` process with a unique label used only by that
   workflow run,
4. triggers a run: a second commit whose head SHA is the correlation key (`trigger:
   push`), or `fire-manual` (`trigger: manual`),
5. waits for the run to reach a terminal state and evaluates `expect.yaml` against the
   run detail, fetching step logs only where `logs` expectations exist.

Anything not listed in `expect.yaml` is not asserted. A flow that needs to orchestrate
from outside (cancellation, listening jobs) ships its own Playwright spec under `tests/`
(for example `tests/listener-jobs.e2e.ts`) instead of an `expect.yaml`; `testMatch` picks
up every `tests/**/*.e2e.ts`, and the spec receives the same `suite` fixture.

### expect.yaml

```yaml
trigger: push            # push (default) | manual
inputs: {}               # manual only: body for fire-manual
timeout_seconds: 180     # terminal-state budget, default 180

run:
  status: succeeded      # required: succeeded | failed | cancelled
runner_log:              # optional assertions against the local runner process log
  exclude: ["SECRET_VALUE"]
jobs:                    # optional, keyed by job key
  build:
    status: succeeded
    status_reason: step_failed   # optional: why the job ended (step_failed, condition_false, ...)
    steps:               # optional, keyed by step key or name
      greet:
        status: succeeded
        exit_code: 0     # optional
        gate_result:     # optional: assert the latest attempt's gate evaluation
          kind: evaluation_error
          reason: gate expression evaluation failed
          exit_code: 0
        error:           # optional: assert the step failed for a specific reason
          reason: config_unresolvable  # step error reason enum
          field: env.VERSION           # exact match on the failing field
          source: steps.build.outputs  # substring match on the unresolved source
        logs:
          include: ["hello world"]   # substring, or /regex/
          exclude: ["SECRET_VALUE"]
```

Assertions that are only observable inside the runner (checkout contents, env
propagation) are written as self-asserting `run` steps in the workflow itself; the
manifest then only asserts the run succeeded.

### reject.yaml

Use `reject.yaml` instead of `expect.yaml` when the workflow must be rejected during
definition sync and therefore never produces a run.

```yaml
error_code: invalid-definition   # optional, defaults to invalid-definition
message_includes:                # optional substrings in sync.last_error_message
  - unknown context
```

The harness seeds the workflow, waits for the definition sync to settle, asserts the
sync failed with the expected error code and message substrings, then polls briefly to
confirm the project has no workflow runs.

## Local run

Each scenario starts a local runner process from `apps/runner/src/index.ts` through
`tsx`, registers it with a manual registration token, and injects a unique runner label
into the workflow YAML. The runner and API both run on the host, so the default
localhost API and gitea URLs are correct for the standard dev stack.

```sh
# 1. Infrastructure (postgres, temporal, garage, gitea)
docker compose up -d            # Conductor worktrees: node dev/worktree-services.mjs up

# 2. Start the API/client dev servers and run the suite.
mise run e2e -- --filter=@shipfox/e2e-platform-workflows
```

The `e2e` task reads Conductor worktree ports from `.context/local-services/env`
through mise, starts the API with E2E routes enabled, starts the client with the
test VCS provider enabled, waits for both to become ready, then runs
`turbo test:e2e`. API/client logs and failure diagnostics are written under
`.context/shipfox-e2e-logs/`.

Reruns need no cleanup: every org, repo, project, and workspace name carries a unique
id. To reset gitea wholesale: `docker compose down && docker volume rm <gitea volume>`.

The pure `expect.yaml` and `reject.yaml` evaluators have Vitest node tests (no
infrastructure):

```sh
turbo test --filter=@shipfox/e2e-platform-workflows
```

## Configuration

Gitea admin/webhook variables live in `@shipfox/e2e-helper-integrations-gitea`.
`API_URL` / `E2E_ADMIN_API_KEY` live in `@shipfox/e2e-core`.

## Artifacts

On failure a scenario attaches the run detail JSON, the evaluated mismatch diff, and
the fetched step logs to its Playwright result. Each local runner writes stdout and
stderr to `.e2e-run/runners/<label>.log`; failing scenarios attach that runner log.
