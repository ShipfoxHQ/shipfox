# @shipfox/e2e-flow-workflows

For the repo-wide E2E rules, level decision tree, dependency boundaries, and
review checklist, start with [`../../../README.md`](../../../README.md). This
file is the deep runbook for the workflow flow suite.

End-to-end tests where each case is a real workflow YAML run through the whole
platform: a gitea push, the org webhook, definition sync, trigger dispatch, Temporal
orchestration, a local source runner, step execution, and log capture. The suite
asserts on the public bounded observation APIs (`/workflows/runs`, run lineage and
overview, selected job/execution/step/attempt/context resources, and the step logs
route). Scenarios with a `gitea` fixture also verify the external Gitea state through
the driver.

## How a scenario works

A scenario is a directory under `scenarios/`:

```
scenarios/hello-world/
  workflow.yml    pushed verbatim to .shipfox/workflows/hello-world.yml
  expect.yaml     declarative expectations (run/job/step status and type, errors, gates, exit code, logs)
  reject.yaml     alternative to expect.yaml for authoring-time rejection scenarios
  model-provider.yaml optional fake model-provider script metadata
  scripted.yaml   optional replies of the managed `shipfox` model provider
  secrets.yaml    optional E2E setup secrets to seed before the run
  files/          optional extra repo files, committed alongside the workflow
```

An `expect.yaml` scenario whose workflow has a `uses:` step, from `files/` or the local
registry, gets its definition from the definition sync, because only a sync snapshots actions.
Other `expect.yaml` scenarios create their definition with `POST /definitions`. Registry scenarios reference the
fixture packages the harness seeds, such as `fixture/example@1.0.0`.

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
   bounded workflow observation, fetching step logs only where `logs` expectations exist.

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
        type: run         # optional: setup | run | agent | checkout | tool | action | composite | wait | cancel | post
        status: succeeded # pending | running | succeeded | failed | skipped | cancelled
        exit_code: 0     # optional
        gate_result:     # optional: assert the latest attempt's gate evaluation
          kind: evaluation_error
          reason: gate expression evaluation failed
          exit_code: 0
        error:           # optional: assert the step failed for a specific reason
          reason: config_unresolvable  # step error reason enum
          field: env.VERSION           # exact match on the failing field
          source: steps.build.outputs  # substring match on the unresolved source
          message: exited before       # substring match on the error message
        logs:
          include: ["hello world"]   # substring, or /regex/
          exclude: ["SECRET_VALUE"]
gitea:                    # optional external fixture and post-run assertion
  issue:
    title: Tool step fixture
    body: Read this issue from the workflow.
  comment: Tool step comment
```

A step without a key, such as a `wait` or `cancel` row or a post, is matched by its
name: `Wait for parallel steps`, `Wait for background steps` for the wait added at the end of
a job, `Wait for <key>`, `Cancel <key>`, or `Post <step name>`.

Assertions that are only observable inside the runner (checkout contents, env
propagation, or output propagation) are written as self-asserting `run` steps in the
workflow itself. A `gitea` block creates the declared issue before the workflow is
synced and checks for the exact comment after the run completes.

### model-provider.yaml

Use `model-provider.yaml` only for scenarios backed by the deterministic
`@shipfox/e2e-driver-model-provider` sidecar:

```yaml
script_key: agent-output-tool
```

`globalSetup` starts the sidecar, creates known scenario scripts, and writes a
`script_key` to script id map into the suite context. `runScenario` uses that map to
attach `GET /scripts/:scriptId/requests` to failing Playwright results. The attachment
contains each provider request's index, model, advertised tools, message roles, served
response, and assertion failures.

The flow suite uses the fake provider for `agent-output-tool` output-plumbing coverage.
The script is registered as a normal `openai-completions` custom provider through the
product HTTP route; the API has no `/__e2e` fake-provider control surface. Required
script assertions are the deterministic model name and `set_output` tool presence.

### scripted.yaml

Use `scripted.yaml` for agent steps on `provider: shipfox` with a catalog model, such as
`gpt-6-luna`. The harness registers the replies for the scenario's project before it
triggers the run. The format is the eval suite's `scripted.yaml`:

```yaml
- match: {prompt_contains: Review the diff for security issues}
  replies:
    - tool: set_output
      args: {key: findings, value: none}
    - text: Done.
```

Each step attempt takes the first entry whose `prompt_contains` is in its prompt, then
reads the entry's replies in order. A prompt that matches no entry fails its step, which
is how a scenario makes an agent step fail.

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

## Docker on the runner host

`scenarios/background-service-cancel` starts a Postgres service with `docker run` from a
background step, so the local runner's host needs Docker. It uses `postgres:18.4`, the
image of the compose stack that local runs and CI already start, so it pulls nothing.
Update the tag when `compose.yml` changes it.

## Reference actions

`reference-actions/` holds the three workflow action recipes the docs publish: a Slack thread
exported to Markdown, local changes published as a verified commit on a pull request branch,
and a Linear issue's context with its uploaded files. `tests/reference-actions.e2e.ts` commits
each one under `.shipfox/actions/` and runs it against the Slack, GitHub, and Linear mocks in
`src/`. The package type check covers the recipes, so they stay valid against `@shipfox/actions`.
Each recipe also has an `index.test.ts` beside it, written with `runAction` and fake tools from
`@shipfox/actions/testing`. The package's Vitest run includes them, and the docs publish them
with the recipes.

`cache-restore` and `cache-save` are the exception: they are the registry actions of the cache,
kept here while they are tested. `tests/cache.e2e.ts` runs both as repository actions, then as a dev
run, against Garage. It covers a miss, a save, an exact hit in another working directory and home, a
prefix hit, two jobs saving one key, and the dev-run sandbox. At launch, move them to
`libs/shared/workflow/catalog/actions/` and add the `package.json`, `tsconfig.json`, and
`vitest.config.ts` that the other catalog actions have. The next release then publishes them, so do
it only at launch.

Keep the recipes readable as user code: they import only their own files, Node built-ins, and
`@shipfox/actions`, and they use only erasable TypeScript syntax, since Node strips the types.

## Job containers

`tests/job-container.e2e.ts` runs one job in a container: a run step calls an executable
that only the image has, an action sets an output, a run step mounts the workspace in a
sibling container, and a run step pushes to Gitea. The spec builds the image from
`fixtures/container-toolbox/` and pushes it to a registry it starts on a loopback port,
because the runner always pulls the job image. It also deploys the runner to a directory,
because the job container mounts the runner installation and a runner started from
source keeps its packages outside it. The image helper is in
`@shipfox/e2e-driver-runner-process`, and `deployRunner` is in `src/deployed-runner.ts`.

The job container runs the Node binary of the runner, so the spec is skipped unless the
host is Linux.

## Custom MCP servers

`tests/custom-mcp-servers.e2e.ts` runs a pi agent step with two `mcp_servers` entries. The
spec commits `fixtures/mcp-server/fake-stdio-mcp-server.sh`, a stdio MCP server in POSIX sh,
and passes it a secret through `env`. It also starts a Streamable HTTP MCP server on a
loopback port, which the local runner reaches through `url`, and passes it a second secret
through `headers`. A scripted model calls the tool of each server. The spec checks that the
model received the values derived from the secrets, and that the step transcript masks the
secrets themselves.

## Composite actions

`tests/composite-actions.e2e.ts` runs one local composite action, committed from
`fixtures/composite-action/`. Its inner steps run the registry action
`fixture/example@1.0.0`, print a secret input, call Gitea `get_issue` through an
integration alias the caller binds, restart from an inner step after a gate
fails once, run a script from `${{ action.path }}`, and run a scripted agent
whose prompt reads a file from `${{ action.path }}`. The spec checks the
composite step, its outputs, each inner step's `parent_step_id`, the masked
log, and the restart attempts.

## GitHub installation lifecycle

`tests/github-installation-lifecycle.e2e.ts` adds a cron workflow, scheduled every minute,
whose job checks out the project's GitHub repository. It then sends `installation.deleted`
from the GitHub fake. It checks that the connection is `error` with provider access
`removed`, and that a tick records an `errored` event with a `source-connection-unavailable`
decision and no run. Then it reinstalls: a second fake serves a new installation ID with the
same repository, and the E2E connect route connects it with the same account ID. It checks
that the connection keeps its ID and slug and is `active`, and that a later tick starts a run
that checks out the repository. The spec waits on real cron ticks, so it takes about two
minutes.

## Local run

Each scenario starts a local runner process from `apps/runner/src/index.ts` through
`tsx`, registers it with a manual registration token, and injects a unique runner label
into the workflow YAML. The runner and API both run on the host, so the default
localhost API and gitea URLs are correct for the standard dev stack.

```sh
# 1. Infrastructure (postgres, temporal, garage, gitea)
docker compose up -d            # Conductor worktrees: pnpm dev:services:up

# 2. Start the API/client dev servers and run the suite.
mise run e2e -- --filter=@shipfox/e2e-flow-workflows
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
turbo test --filter=@shipfox/e2e-flow-workflows
```

## Configuration

Gitea admin/webhook variables live in `@shipfox/e2e-driver-gitea`.
`API_URL` / `E2E_ADMIN_API_KEY` live in `@shipfox/e2e-core`.

## Artifacts

On failure a scenario attaches the bounded workflow observation JSON, the
evaluated mismatch diff, and the fetched step logs to its Playwright result.
Each local runner writes stdout and stderr to `.e2e-run/runners/<label>.log`;
failing scenarios attach that runner log.
