<div align="center">
  <img src="https://www.shipfox.io/og-image.png" alt="Shipfox" width="640" />
</div>

<p align="center">
  <a href="https://www.shipfox.io/docs"><b>Docs</b></a> ·
  <a href="#getting-started"><b>Getting started</b></a> ·
  <a href="#core-concepts"><b>Concepts</b></a> ·
  <a href="https://join.slack.com/t/shipfoxcommunity/shared_invite/zt-42wdu4lvl-KiYxEKCzzHUCafiC0EjbVA"><b>Slack community</b></a> ·
  <a href="CONTRIBUTING.md"><b>Contributing</b></a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://github.com/ShipfoxHQ/shipfox/actions/workflows/ci.yml"><img src="https://github.com/ShipfoxHQ/shipfox/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome" />
</p>

**Shipfox is a continuous shipping platform for workflows that reason and react.**

Most automation is trigger-based: an event fires a fixed job graph, and the run
plays out on rails. Shipfox is built on two shifts that go further.

**Workflows reason.** A step isn't limited to a shell command. Any step can be an
agent (a model with your repository checked out) that reads code, runs tools, and
makes changes. Agents are first-class: they share one lifecycle with shell steps,
so an agent can be **gated and retried until a real check passes**. It edits, your
tests run, and the workflow loops back until they're green.

**Workflows react.** An event is not only an entry point; it is a first-class
control-flow signal. Beyond starting a run, events can advance a workflow while it
is still running, so a run becomes a stateful process that reacts to what arrives
rather than a one-shot graph. A [listening job](docs/concepts/listening-jobs.mdx)
wakes on each batch of events and runs again inside the same run, until a
resolution condition is met.

Everything runs on **runners you own**, and every step, including the agent's full
reasoning, streams live to the dashboard.

```yaml
name: Fix Sentry issues & answer PR reviews
runner: ubuntu-latest

triggers:
  on_issue:
    source: sentry_acme         # a new Sentry issue starts the run
    event: issue.created

jobs:
  fix:                            # opens the PR
    steps:
      - model: claude-opus-4-8
        prompt: >
          Sentry reported "${{ event.title }}" (${{ event.webUrl }}).
          Find the cause, fix it, and push a fix branch.
      - key: create-pr             # stdout is just the PR URL
        run: basename "$(gh pr create --fill)"   # → the PR number

  review:
    needs: fix
    name: Review batch ${{ execution.index }}
    listening:                     # event-driven job
      on:
        - source: github_acme
          event: issue_comment.created
          filter: event.issue.number == fix.output.pr_number
      until:                       # resolves the listener
        - source: github_acme
          event: pull_request       # fires on merge / close
      timeout: 30d
      max_executions: 10
      batch:
        debounce: 5s              # collapse rapid comments
        max_size: 10
        max_wait: 1h
    steps:
      - model: claude-opus-4-8
        prompt: |
          Address every comment in this review batch:
          ${{ execution.events.map(e, e.data.body) }}  # an array of issue comments
          Push fixes and reply on the thread.
```

If you've written GitHub Actions, you already know how to read this file, and
that's deliberate. What's different is what a step can do and the control flow
around it: a Sentry issue starts the run, an agent finds the cause and opens a PR,
then a **listening job** wakes on each batch of review comments and runs an agent
to answer them, until the PR merges.

## Highlights

- **Workflows as code.** YAML under `.shipfox/workflows/`, versioned and reviewed
  like the rest of your repo. No plugin, no action, no glue.
- **Bounded retry loops.** A gate's `success_if` plus `restart_from` loops back to
  an earlier step until a real check passes, automatically bounded, no scripting.
- **See the agent think.** Agent steps stream structured events (messages,
  thinking, tool calls, token usage, and cost), not just raw text.
- **Your own runners, your own keys.** Runners poll outbound, so nothing connects
  into your network. Model traffic leaves from your runners across 30+ providers.

## How a run executes

```
event source → trigger match → run created (event data resolved into prompts)
             → jobs scheduled as a needs DAG
             → a runner on your compute polls outbound and claims a job
             → it re-clones the repo and runs each step (shell or agent)
             → a gate can loop back on failure
             → logs and agent sessions stream live to the dashboard
```

## Core concepts

| Concept | Summary |
|---|---|
| **Workflow** | A YAML file under `.shipfox/workflows/`, versioned and reviewed like code. One file, one workflow. |
| **Trigger** | What starts a run: an event from a connected source, or an on-demand fire. |
| **Job** | A group of steps on one runner. Jobs form a DAG via `needs` and are isolated, so each re-clones the repo. |
| **Step** | A `run` shell command or an agent (`model` + `prompt`). Runs in order within a job. |
| **Gate** | A CEL `success_if` on a step plus `on_failure.restart_from` to build bounded retry loops. |
| **Runner** | A process you register on your own compute; matched to jobs by label. |

## Repository layout

Shipfox is a pnpm + Turborepo monorepo.

| Path | Role |
|---|---|
| [`apps/api`](apps/api) | Control plane: definitions, triggers, dispatch, runs, logs, auth |
| [`apps/client`](apps/client) | Operator dashboard: run detail, job graph, live log and agent-session tails |
| [`apps/runner`](apps/runner) | Polls the API for jobs and executes their steps on the runner host |
| [`apps/provisioner-docker`](apps/provisioner-docker) | Starts ephemeral, single-job runners on demand |
| [`libs/`](libs) | Feature logic by tier: `api`, `client`, `runner`, `provisioner`, `shared` |
| [`e2e/`](e2e) | End-to-end suites, including the full workflow run loop |
| [`docs/`](docs) | Product documentation (Mintlify) |

Public HTTP contracts are shared through sibling `*-dto` packages so the backend,
client, and E2E helpers speak the same schema.

## Getting started

To run the full stack on your machine (API, dashboard, PostgreSQL, Temporal,
object storage, and a local Git host), then connect a project, register a runner,
and fire your first run, follow the
[**Local Evaluation guide**](docs/installation/local.mdx)
([shipfox.io/docs/installation/local](https://www.shipfox.io/docs/installation/local)).
It walks through the whole loop end to end.

Prerequisites: [mise](https://mise.jdx.dev/) (manages Node, pnpm, Turbo, Ollama)
and [Docker](https://docs.docker.com/get-docker/).

```sh
# Install the pinned toolchain
mise install

# Start local service dependencies (PostgreSQL, Temporal, object storage, test VCS)
docker compose up -d

# Install workspace dependencies and build everything
pnpm install
turbo build

# Run a dev app with hot reload
pnpm --filter=@shipfox/api dev
```

Common tasks:

```sh
turbo check      # lint + format + import sorting
turbo type       # type-check
turbo test       # unit + integration tests (real Postgres, minimal mocks)
```

Scope any Turbo task to one package with `--filter`, e.g.
`turbo test --filter=@shipfox/api...`. See [CONTRIBUTING.md](CONTRIBUTING.md) for
the full setup, tooling, and workflow.

## Deploying Shipfox

Standing up Shipfox has two parts: a **control plane** (the stateless API and
dashboard, backed by PostgreSQL, Temporal, and S3-compatible object storage) and
one or more **runners** on compute you own. The runner ships as a Docker image and
is configured through environment variables. See the installation docs for the
local evaluation and self-hosting paths.

## Documentation

Full documentation lives in [`docs/`](docs) and is published at
[shipfox.io/docs](https://www.shipfox.io/docs):

- **Getting started:** connect a project, add a workflow, register a runner, fire a run
- **Concepts:** workflows, jobs & steps, gates, triggers, runners, logging
- **Guides:** agent steps, gate & retry loops, multi-job pipelines, triaging Sentry issues
- **Reference:** workflow schema, step types, expressions (CEL), model providers, REST API
- **Installation:** local evaluation and self-hosting

## Community

- **Slack:** join the [Shipfox community Slack](https://join.slack.com/t/shipfoxcommunity/shared_invite/zt-42wdu4lvl-KiYxEKCzzHUCafiC0EjbVA)
  for help, ideas, and release news.
- **Issues:** report bugs and request features on
  [GitHub Issues](https://github.com/ShipfoxHQ/shipfox/issues).

## Security

Please report vulnerabilities privately by emailing **security@shipfox.io** rather
than opening a public issue. See [SECURITY.md](SECURITY.md) for details. Shipfox's
token and trust model is documented in the
[auth security model](libs/api/auth/README.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the codebase conventions in
[CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md) before opening a pull request. UI
work should follow [DESIGN.md](DESIGN.md); E2E work follows [e2e/README.md](e2e/README.md).

## License

[MIT](LICENSE) © Shipfox
