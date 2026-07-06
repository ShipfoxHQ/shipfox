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
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome" />
</p>

**Build your software factory.**

Shipfox is a continuous shipping platform for workflows that reason and react:
every step is a shell command or an AI agent, and events drive the run from start
to finish, on compute you own. A software factory that assembles itself in your
repo.

```yaml
name: Fix new Sentry issues
runner: ubuntu-latest
triggers:
  on_issue:
    source: sentry_acme            # a new Sentry issue starts the run
    event: issue.created
jobs:
  fix:
    steps:
      - run: npm install
      - key: fix                    # an agent step
        model: claude-opus-4-8
        prompt: >
          Sentry reported "${{ event.title }}" (${{ event.webUrl }}).
          Reproduce it in this repository, find the root cause, and fix it.
      - run: npm test               # verify the fix
        gate:
          success_if: exit_code == 0
          on_failure:
            restart_from: fix        # send the agent back until the tests pass
```

If you've written GitHub Actions, you already know how to read this file, and
that's deliberate. What's different is what a step can be and the control flow
around it: a Sentry issue starts the run, an agent reproduces and fixes the cause,
then a `gate` reruns the tests and sends the agent back until they pass.

## Highlights

- **Workflows as code.** YAML under `.shipfox/workflows/`, versioned and reviewed
  like the rest of your repo. No plugin, no action, no glue.
- **Trigger from your whole stack.** Start runs from GitHub, Sentry, Slack, Linear,
  and more through integrations. Missing one? Point it at the generic webhook
  integration and trigger on its events too. Connect several of the same provider
  and target each independently.
- **Bounded retry loops.** A gate's `success_if` plus `restart_from` loops back to
  an earlier step until a real check passes, automatically bounded, no scripting.
- **See the agent think.** Agent steps stream structured events (messages,
  thinking, tool calls, token usage, and cost), not just raw text.
- **Your own runners, your own keys.** Runners poll outbound, so nothing connects
  into your network. Model traffic leaves from your runners across 30+ providers.

## Core concepts

| Concept | Summary |
|---|---|
| **Workflow** | A YAML file under `.shipfox/workflows/`, versioned and reviewed like code. One file, one workflow. |
| **Trigger** | What starts a run: an event from a connected integration, or an on-demand fire. |
| **Integration** | A connection to an external tool (GitHub, Sentry, Slack, Linear, ...) whose events start runs. Use the [generic webhook](docs/integrations/webhooks.mdx) to connect anything not built in. |
| **Job** | A group of steps on one runner. Jobs form a DAG via `needs` and are isolated, so each re-clones the repo. |
| **Step** | A `run` shell command or an agent (`model` + `prompt`). Runs in order within a job. |
| **Gate** | A [`success_if` expression](docs/reference/expressions.mdx) on a step, such as `exit_code == 0`, plus `on_failure.restart_from` to build bounded retry loops. |
| **Listening job** | A [job that waits on events](docs/concepts/listening-jobs.mdx) and runs again per batch inside the same run, until a resolution condition. Drives event-driven, asynchronous workflows. |
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
| [`docs/`](docs) | Product documentation |

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

Full documentation is published at [shipfox.io/docs](https://www.shipfox.io/docs).

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
