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

## Backend architecture

If your task adds or changes a backend module, DTO, outbox event, HTTP boundary,
or server package dependency, read the
[backend architecture guide](docs/architecture/backend-architecture.md). It
owns the current module model and package-boundary rules.

## Module exports and imports

Avoid broad barrel files inside modules. Prefer importing from the file that owns the
symbol, such as `#core/auth.js` or `#presentation/dto/user.js`, rather than
`#core/index.js` or another catch-all index.

Package root exports should stay intentionally small: export only shared entities and
functions that are part of the package's public API. Do not export internal DB helpers,
routes, auth wiring, or test-only utilities from a package root unless another package
is meant to depend on them directly.

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

## Code comments

Default to fewer comments. Well-named functions, types, and variables carry the
intent; the reader knows the language and the codebase, so a comment that
restates the code is pure overhead: it adds nothing to read and silently rots
when the code changes. The bar for a comment is: **would a competent reader be
surprised or stuck without it?** If not, delete it.

### Explain *why*, never *what*

A comment earns its place by capturing intent the code cannot express: a
non-obvious constraint, a workaround, a deliberate trade-off, or a subtlety that
would otherwise read as a mistake. The good comments already in this codebase all
answer "why":

```ts
// Algorithm-confusion guard: nothing outside the HS256 allowlist may verify.

// Drizzle creates its migrations schema/table outside its own migration transaction.
// Serialize migrators so parallel package tests do not race on that shared setup.

// `request.routeOptions.url` is the route template (e.g. /public/cache/:id/chunk)
// but can leak a query string in some Fastify edge cases. Strip it.
```

Delete comments that narrate the next line. These say nothing the code doesn't:

```ts
// bad: restates the code
// Set test environment variable
process.env.FOO = "bar";

// bad: restates the function name
// Helper function to create properly typed configs
export function createConfig(...) {}
```

### Prefer self-documenting code over a comment

When you feel the urge to explain a block, first try to make the explanation
unnecessary: extract a named function, rename a variable, or reach for an
idiomatic construct (`value ?? fallback`, early return, a typed enum). A good
name beats a comment because it travels with every call site and can't drift out
of sync. Only when the *why* genuinely can't live in the code does it become a
comment, and if that why needs a paragraph, the awkwardness is usually the code;
refactor first.

### Keep control flow readable

When a conditional expression is doing real work, name the decision before the
branch. Prefer a small, intention-revealing variable such as `hasPendingStep`,
`usesAuthoredMode`, or `shouldRetry` over repeating a compound expression inside
`if`, ternary, or object-spread conditionals. Inline checks are fine for obvious
single comparisons, but once a condition combines multiple concepts, give it a
name so the branch reads like a sentence.

Split long functions into focused units when they mix distinct responsibilities,
such as loading state, validating preconditions, building a payload, handling an
error branch, and applying the state change. Keep the top-level function as the
orchestration path and move self-contained branches into helpers with names that
describe the decision or action. Do not extract tiny helpers for their own sake;
extract when it removes nesting, clarifies a branch, or gives a meaningful name
to a reusable piece of logic.

### Use JSDoc for documentation, not narration

Reserve `/** ... */` for the public API of shared packages (exported functions,
types, and config that other packages consume), where editor hover-docs add real
value. JSDoc is also appropriate for usage documentation when a function is
intended to be called outside its immediate module or local context and the
caller needs to know constraints, ordering, side effects, or examples that are
not obvious from the signature. Document parameters and behaviour that the
signature can't convey; do not restate the type or the name:

```ts
/**
 * Verifies an HS256-signed token and validates its payload against `schema`.
 * Rejects any token whose `alg` header is outside the HS256 allowlist.
 *
 * @param audience - When set, jose rejects an `aud` mismatch before the schema runs.
 */
```

Self-evident functions need no docstring at all; one that echoes
`getRunner(id): Runner` is noise. But when an internal function does earn a
comment, prefer `/** ... */` over a loose `//`: it attaches to the symbol and
surfaces on hover at every call site.

### Keep planning and process out of the source

No `// TODO`, `// v1 only`, `// added in follow-up PR`, or references to
planning-doc decisions (`/plan-eng-review A1`) in module or function headers.
Speculation about future work ("today X, tomorrow Y") and tracked tasks belong in
`TODOS.md`, the issue tracker, or the design doc, not in code that outlives them.


## Design System

Before an agent creates or changes a visual or UI decision, read
[DESIGN.md](DESIGN.md). It owns the shared design system and points to the
code that owns exact token and component values.
