# Contributing

This project and everyone participating in it are governed by the
[Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to
uphold it.

## Prerequisites

- [mise](https://mise.jdx.dev/) manages the pinned Node.js, pnpm, Turbo, and
  Ollama versions.
- [Docker](https://docs.docker.com/get-docker/) runs local service dependencies.

## Get started

Install the pinned tools and workspace dependencies:

```sh
mise install
mise exec -- pnpm install
```

Start local dependencies and build the repository:

```sh
docker compose up -d
mise exec -- turbo build
```

Use `mise exec --` for shell scripts and automation. Run `mise tasks` to find
repository tasks.

## Normal contribution loop

Make a focused change, then run the smallest validation that proves it. Start
with the changed package and its dependents:

```sh
mise exec -- turbo <task> --filter=@shipfox/<package>...
```

Before opening a pull request, run the validation required by the changed
surface and make sure the change is scoped to the contribution. The
[local development and release workflow](docs/guides/local-development-and-release-workflow.md)
owns task selection, affected-package validation, local-service recovery,
Conductor and Ollama recovery, Changesets, and package release procedures.

## Find the context for your task

Read the linked source before making the matching change. For a task not listed
here, use the full [engineering documentation map](docs/README.md).

| When your task... | Read | It owns |
| --- | --- | --- |
| Needs task selection, local-service recovery, shared Ollama, affected-package validation, or package release procedures. | [Local development and release workflow](docs/guides/local-development-and-release-workflow.md) | Shared contributor procedures. |
| Adds, updates, or exempts a dependency. | [Dependency version policy](docs/policies/dependency-versions.md) | Version rules, exceptions, package families, and dependency checks. |
| Adds or changes a backend module, DTO, outbox event, HTTP boundary, or server package dependency. | [Backend architecture](docs/architecture/backend-architecture.md) | The current backend module model and package-boundary rules. |
| Changes client state, API adapters, forms, or feature-domain boundaries. | [Client architecture](docs/architecture/client-architecture.md) | The current client model, form rules, and architecture enforcement. |
| Adds or changes an environment variable, validator, or environment description. | [Configuration policy](docs/policies/configuration.md) | Configuration ownership, validation, and description rules. |
| Adds a domain or provider error, translates a request failure, or reports an unexpected failure. | [Error handling](docs/architecture/error-handling.md) | The error model, client translation, and reporting boundaries. |
| Adds a metric or changes instrumentation startup, naming, units, or labels. | [Observability](docs/architecture/observability.md) | The metrics model and cardinality constraints. |
| Mints, verifies, or carries an authentication token. | [Auth security model](libs/api/auth/README.md#security-model) | Token authority, lifetime, trust boundaries, and logging constraints. |
| Adds or changes unit tests, Storybook stories, or visual regression coverage. | [Testing guide](docs/guides/testing.md) | Test selection, Storybook conventions, and visual-review workflow. |
| Adds or changes end-to-end coverage. | [E2E guide](e2e/README.md) | E2E suite structure, setup, screens, and package boundaries. |
| Creates or changes a visual or interaction decision. | [Design system](DESIGN.md) | Shared design guidance; code owns exact token and component values. |
| Writes engineering prose, a package README, or a runbook. | [Writing guide](WRITING.md) | Repository prose and package-README standards. |
| Writes product or self-hosting documentation. | [Docs writing guide](apps/docs/WRITING.md) | Product-documentation page types, templates, and terminology. |
| Writes or reviews code comments, module exports, or non-trivial control flow. | [Code style policy](docs/policies/code-style.md) | Shared code-comment, import and export, and control-flow rules. |
| Changes a cross-package client composition seam, server module boundary, or shared server-package boundary. | [Engineering documentation map](docs/README.md) | The applicable ADR and its decision boundary. |
| Changes repository documentation structure or adds a shared documentation surface. | [ADR 0005](docs/adr/0005-repository-documentation-architecture.md) | Documentation ownership, routing, and progressive disclosure. |
