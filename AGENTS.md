# Agent guidelines

Read [CONTRIBUTING.md](CONTRIBUTING.md) when the task needs human contribution
workflow or onboarding context.

## Agent execution

Use mise-managed tools. Prefix non-interactive commands with `mise exec --`.
Use `turbo <task> --filter=@shipfox/<package>...` to validate the changed
package and its dependencies before widening validation.

If the task needs task selection, local-service recovery, shared Ollama, or
release procedures, read the
[local development and release workflow guide](docs/guides/local-development-and-release-workflow.md).
It owns those shared contributor procedures.

If the task adds, updates, or exempts a dependency, read the
[dependency version policy](docs/policies/dependency-versions.md). It owns
dependency rules and required checks.

If the task writes or reviews code comments, module exports, or non-trivial
control flow, read the [code style policy](docs/policies/code-style.md). It owns
the shared rules for those code decisions.

## Backend architecture

If your task adds or changes a backend module, DTO, outbox event, HTTP boundary,
or server package dependency, read the
[backend architecture guide](docs/architecture/backend-architecture.md). It
owns the current module model and package-boundary rules.

## Codebase conventions

### Backend modules

Backend feature packages are composed as declarative modules. A feature package
typically exports a `ShipfoxModule` that declares its `database`, `routes`,
`auth`, `e2eRoutes`, `publishers`, `subscribers`, and/or `workers`; apps should
compose those module declarations rather than wiring feature internals directly.
Module initialization runs in array order, so list modules with shared database
dependencies before dependents.

API feature packages usually follow a layered shape:

```text
src/
  core/          Domain behavior, entities, providers, and typed errors
  db/            Drizzle schema, migrations, persistence functions, row mappers
  presentation/  Fastify routes, auth adapters, and DTO conversion
```

### HTTP routes

Define HTTP endpoints with `defineRoute`, Zod schemas, and named auth methods
from `@shipfox/node-fastify` / `@shipfox/api-auth-context`. Prefer route groups
for shared prefixes, plugins, and inherited auth instead of repeating those
concerns in each route.

### DTOs and API contracts

Public HTTP contracts live in sibling `*-dto` packages. Put Zod request/response
schemas, inferred DTO types, and public event names/payload types there so the
backend, client, and E2E helpers all share the same contract.

Use camelCase for internal domain objects and snake_case for external HTTP DTOs.
Keep the conversion centralized in `presentation/dto/*` files; route handlers
should call a mapper like `toProjectDto()` rather than manually shaping response
objects inline.

### Persistence and events

Drizzle schema files own row-to-domain mapping. A table file should define the
table, infer DB types, and export `toX()` mappers; higher layers should work with
domain objects rather than raw Drizzle rows where possible.

Outbox events are part of a module's public contract. Define event names and
payload maps in the module's `*-dto` package, write outbox events in the same
transaction as the state change, and register publisher tables on the module
declaration.

### Client architecture and forms

When a task adds or changes a client feature, API adapter, query, route state,
form, atom, browser storage, or cross-feature client flow, read the
[client architecture guide](docs/architecture/client-architecture.md). It owns
the current client model, form rules, and architecture enforcement.

### Testing

If you add or change unit tests, Storybook stories, or visual regression
coverage, read the [testing guide](docs/guides/testing.md). It owns test level
selection, unit-test conventions, Storybook ordering, Argos build names, and
visual review.

If you add or reshape E2E coverage, read the [E2E guide](e2e/README.md). It
owns suite architecture, HTTP-first setup, screens, drivers, dependencies, and
the workflow-flow runbook routing.

### Backend cross-cutting rules

If your task adds or changes an environment variable, validator, or environment
description, read the [configuration policy](docs/policies/configuration.md). It
owns repository-wide configuration rules.

If your task adds a domain or provider error, translates a request failure, or
reports an unexpected failure, read [error handling](docs/architecture/error-handling.md).
It owns the backend error model and reporting boundaries.

If your task adds a metric or changes instrumentation startup, naming, units, or
labels, read [observability](docs/architecture/observability.md). It owns the
backend metrics model and cardinality constraints.

If your task mints, verifies, or carries an authentication token, read the
[Auth security model](libs/api/auth/README.md#security-model). It owns token
authority, lifetime, trust boundaries, and logging constraints.

## Design System

Before an agent creates or changes a visual or UI decision, read
[DESIGN.md](DESIGN.md). It owns the shared design system and points to the
code that owns exact token and component values.
