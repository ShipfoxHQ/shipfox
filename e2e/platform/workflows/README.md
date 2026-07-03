# @shipfox/e2e-platform-workflows

End-to-end tests where each case is a real workflow YAML run through the whole
platform: a gitea push, the org webhook, definition sync, trigger dispatch, Temporal
orchestration, a docker-provisioned runner, step execution, and log capture. The suite
asserts only on the public observation APIs (`/workflows/runs`, `/workflows/runs/:id`,
and the step logs route).

## How a scenario works

A scenario is a directory under `scenarios/`:

```
scenarios/hello-world/
  workflow.yml    pushed verbatim to .shipfox/workflows/hello-world.yml
  expect.yaml     declarative expectations (run/job/step status, exit code, logs)
  files/          optional extra repo files, committed alongside the workflow
```

`tests/scenarios.e2e.ts` discovers every directory that contains an `expect.yaml` and
registers one Playwright test for it. Each test, against the shared suite arrangement:

1. creates a fresh gitea repo and a project bound to it,
2. seeds the workflow (and any `files/`) in one commit, then waits for the definition
   to resolve (this closes the sync/dispatch race),
3. triggers a run: a second commit whose head SHA is the correlation key (`trigger:
   push`), or `fire-manual` (`trigger: manual`),
4. waits for the run to reach a terminal state and evaluates `expect.yaml` against the
   run detail, fetching step logs only where `logs` expectations exist.

Anything not listed in `expect.yaml` is not asserted. A flow that needs to orchestrate
from outside (cancellation, listening jobs) ships a `spec.e2e.ts` in its directory
instead of an `expect.yaml`; it is an ordinary Playwright spec and receives the same
`suite` fixture.

### expect.yaml

```yaml
trigger: push            # push (default) | manual
inputs: {}               # manual only: body for fire-manual
timeout_seconds: 180     # terminal-state budget, default 180

run:
  status: succeeded      # required: succeeded | failed | cancelled
jobs:                    # optional, keyed by job key
  build:
    status: succeeded
    steps:               # optional, keyed by step key or name
      greet:
        status: succeeded
        exit_code: 0     # optional
        logs:
          include: ["hello world"]   # substring, or /regex/
          exclude: ["SECRET_VALUE"]
```

Assertions that are only observable inside the runner (checkout contents, env
propagation) are written as self-asserting `run` steps in the workflow itself; the
manifest then only asserts the run succeeded.

## Local run

Runners run in docker; the API runs on the host. A runner reaches both gitea and the API
through `host.docker.internal`, because the compose services sit on the default bridge
network (`network_mode: bridge`), which has no service-name DNS. So the runner clones
gitea via the host-published gitea port, set through `GITEA_CLONE_BASE_URL` on the API for
this suite only.

```sh
# 1. Infrastructure (postgres, temporal, garage, gitea)
docker compose up -d            # Conductor worktrees: node dev/worktree-services.mjs up

# 2. Build the runner image the provisioner launches (loads runner:ci locally)
turbo image --filter=@shipfox/runner

# 3. API on the host, with E2E routes on and a gitea clone URL the runner containers can
#    reach. Use the gitea port for your setup (3000 by default; a worktree's port is in
#    .context/local-services/env). Set GITEA_CLONE_BASE_URL only when running this suite,
#    since host-based manual runners want the default clone URL.
E2E_ENABLED=true GITEA_CLONE_BASE_URL=http://host.docker.internal:3000 \
  pnpm --filter=@shipfox/api dev

# 4. Run the suite. E2E_DOCKER_NETWORK is the docker network runner containers join
#    (bridge for the compose default). API_URL and E2E_GITEA_URL default to
#    http://localhost:16101 and http://localhost:3000; override them when services run on
#    other ports (a Conductor worktree's ports are in .context/local-services/env).
E2E_DOCKER_NETWORK=bridge turbo test:e2e --filter=@shipfox/e2e-platform-workflows
```

Reruns need no cleanup: every org, repo, project, and workspace name carries a unique
id. To reset gitea wholesale: `docker compose down && docker volume rm <gitea volume>`.

The pure `expect.yaml` evaluator has its own Vitest node tests (no infrastructure):

```sh
turbo test --filter=@shipfox/e2e-platform-workflows
```

## Configuration

Suite variables (see `src/config.ts`); gitea admin/webhook variables live in
`@shipfox/e2e-helper-integrations-gitea`, and `API_URL` / `E2E_ADMIN_API_KEY` in
`@shipfox/e2e-core`.

| Variable | Default | Purpose |
| -- | -- | -- |
| `E2E_DOCKER_NETWORK` | (required) | compose network runner containers join |
| `E2E_RUNNER_IMAGE` | `runner:ci` | image the provisioner launches |
| `E2E_API_HOST_FROM_CONTAINER` | `host.docker.internal` | host a runner uses to reach the API |

## Artifacts

On failure a scenario attaches the run detail JSON, the evaluated mismatch diff, and
the fetched step logs to its Playwright result. Global setup streams the child
provisioner's output to `.e2e-run/provisioner.log`.
