# Agent guidelines

Read [CONTRIBUTING.md](CONTRIBUTING.md) before working on this project.

## Running tasks locally

This project uses [mise](https://mise.jdx.dev/) to manage tool versions. `node`, `pnpm`, and `turbo` are all available in the shell: no `npx` needed.

```sh
# Install dependencies
pnpm install

# Build all packages
turbo build

# Check (lint + format + import sorting) / type-check / test
turbo check
turbo type
turbo type:emit
turbo test

# Scope to a specific package
turbo build --filter=@shipfox/api...

# Start local services (Docker required)
docker compose up -d

# Dev mode with hot-reload (apps only)
pnpm --filter=@shipfox/api dev
```

## Dependency management

Read the [dependency version policy](docs/policies/dependency-versions.md)
before adding, updating, or exempting a dependency. It defines catalog range
rules, peer compatibility, coordinated Renovate families, and the contributor
workflow.

After a dependency change, run:

```sh
pnpm check:dependencies
pnpm check:lockfile
pnpm check:published-artifacts
pnpm install --frozen-lockfile
```

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

### Client packages

Client feature packages should expose both transport functions and React Query
hooks. Use `@shipfox/client-api` for JSON requests, auth refresh, and `ApiError`
handling; colocate query keys, raw request functions, and hooks in the feature's
`hooks/api/*` module.

### Form management

Client forms use `@tanstack/react-form` driven by the `*BodySchema` Zod schemas
from the matching `*-dto` package. Zod 3.24+ implements Standard Schema, so
schemas pass directly to TanStack Form's `validators`:

```ts
const form = useForm({
  defaultValues,
  onSubmit: async ({value}) => { /* mutation */ },
});

<form.Field
  name="email"
  validators={{onBlur: bodySchema.shape.email, onSubmit: bodySchema.shape.email}}
>
```

Do not add `@tanstack/zod-form-adapter` or write custom Zod adapters: the
adapter package is legacy (pinned to form-core v0.x) and unnecessary on v1+.

Render every labeled input through `FormField` from `@shipfox/react-ui`, using
`FormFieldInput` to inherit the field's id, `aria-invalid`, and
`aria-describedby` automatically:

```tsx
<FormField label="Email" id="email" error={fieldError(field)}>
  <FormFieldInput
    type="email"
    value={field.state.value}
    onChange={(event) => field.handleChange(event.target.value)}
    onBlur={field.handleBlur}
  />
</FormField>
```

Validation runs `onBlur` per field and `onSubmit` for the form. Show field
errors only after the field has been blurred or after a submit attempt. See
the `fieldError(field)` helper at the bottom of each page form for the
boilerplate.

Server errors are classified by a per-feature `errorToFormError(error)` pure
function in `form-errors.ts`. It returns either
`{kind: 'field', field, message}` (routed to
`form.setFieldMeta(field, prev => ({...prev, errorMap: {...prev.errorMap, onServer: message}}))`)
or `{kind: 'form', message}` (rendered in an `<Alert>` above the form).
Use the `onServer` slot in `errorMap` (not `errors` directly) because
TanStack Form v1 derives `field.state.meta.errors` from `errorMap`, so a
direct write to `errors` gets overwritten on the next derived read.
TanStack Form auto-clears `errorMap.onServer` on the next field validation
(blur/change), which is the correct UX. Add a Vitest node test enumerating
every `ApiError` code the feature handles, plus the unknown-error fallback.

For draft persistence across navigation (auth flows), sync TanStack Form values
into a Jotai atom on field blur and on form unmount only (never on every
keystroke) and filter the atom shape explicitly so unrelated fields (e.g.
signup's `name`) don't leak into a `{email, password}` draft.

### Testing

If you add or change unit tests, Storybook stories, or visual regression
coverage, read the [testing guide](docs/guides/testing.md). It owns test level
selection, unit-test conventions, Storybook ordering, Argos build names, and
visual review.

If you add or reshape E2E coverage, read the [E2E guide](e2e/README.md). It
owns suite architecture, HTTP-first setup, screens, drivers, dependencies, and
the workflow-flow runbook routing.

### Configuration

Each app and each package that reads the environment owns a `src/config.ts`. It
calls `createConfig` from `@shipfox/config` (a thin wrapper over envalid) with one
validator per variable: `str`, `num`, `bool`, `host`, `port`, `url`, or `email`. A
validator with a `default` is optional; one without a default is required, so a
missing value fails startup. Keep the file flat: declare the schema, then derive
any helpers (such as a mailer) below it.

Document every variable with the validator's `desc` property, never a `//` comment
beside it. `desc` stays attached to the schema: envalid's default reporter prints it
when a required variable is missing at startup, and any config tooling can read it.
A `//` comment never leaves the source file. When you find an existing `//` note on
a config param, move it into `desc`.

Write the descriptions for self-hosters, not for maintainers:

- Plain language, one idea per sentence, present tense.
- Say what the variable does and how to set it.
- List the accepted values when the variable is constrained: enums like
  `LOG_LEVEL` or `MAILER_TRANSPORT`, a URL, a comma-separated list.
- Note when a variable is required, or when it depends on another (for example,
  `SMTP_HOST` is required when `MAILER_TRANSPORT` is `smtp`).
- No marketing words.

```ts
export const config = createConfig({
  AUTH_JWT_SECRET: str({
    desc: 'Secret used to sign and verify user access tokens (JWTs). Required, with no default, so startup fails when it is missing.',
  }),
  MAILER_TRANSPORT: str({
    desc: 'How emails are delivered. Use console to print them to the log, or smtp to send them through an SMTP server.',
    default: 'console',
  }),
});
```

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

## Auth & token security

The auth module issues two stateless bearer tokens, a **user session token** and
a **job lease token**, each signed with a distinct key derived from
`AUTH_ROOT_KEY`. Rotating the root invalidates every derived-token type. The full
security model (trust boundaries, scope, threat model, and rotation) lives in
`libs/api/auth/README.md#security-model`; read it before touching anything that
mints, verifies, or carries either token.

The job lease token is a single-job **capability**, not an identity. When working
near it, keep its authority narrow:

- **Keep the scope to one job.** Do not add claims that grant access beyond the
  single job the lease names. It is not a runner identity, not workspace-wide, and
  not a replacement for the long-lived runner credential.
- **Keep a single issuer; everyone else verifies only.** Scheduling mints leases;
  every other side does an in-process signature check with no callback. Treat the
  runner and the agent workload it hosts as untrusted; they only present a token.
- **Keep the lifetime bounded** and never trade the short TTL for convenience.
- **Server state is the final gate.** A valid token must never be sufficient to
  advance work on its own; on the lease path, terminal step/progression state
  always wins (job finalization is enforced outside it), and cancellation rides on
  the heartbeat response.
- **Never log a raw token.** There is no automatic redaction; tokens must not reach
  logs, traces, or error payloads. Secrets come from configuration, never code.

If the no-revocation window proves too wide, bind the lease to live runner or job
state; do not broaden what the token itself authorizes.

## Error handling

Error handling is a cross-layer concern, not an HTTP detail. The guiding
principle is **let errors bubble up and translate them only when crossing a
boundary**. Each layer owns one job, and the error changes shape only at the
edges:

```
external system  →  api/core: typed error  →  presentation: ClientError  →  global handler  →  HTTP response
```

Never swallow or wrap an error unless you add meaning. If you can re-throw
as-is, do. Do not catch errors just to log them; let unknowns reach the global
handler.

### Domain errors (`core` / `db`)

Throw typed domain errors from domain and persistence code. Define them in
`core/errors.ts` as plain `Error` subclasses with a human-readable message, a
`name`, and any context as public readonly fields. They carry **no HTTP
concerns** (no status, no client-facing code), which keeps them reusable by
workers, subscribers, and jobs, not just routes:

```ts
export class WorkspaceNotFoundError extends Error {
  constructor(workspaceId: string) {
    super(`Workspace not found: ${workspaceId}`);
    this.name = 'WorkspaceNotFoundError';
  }
}
```

### External and infrastructure errors (`api` / `core`)

Catch errors from external systems (GitHub, GCP, etc.) at the layer that talks
to them and re-throw them as a typed error carrying a `reason` enum (e.g.
`IntegrationProviderError`) rather than letting raw SDK errors leak upward.
Callers then branch on `reason` without depending on the SDK's error shapes.
Pass `retryAfterSeconds` for backpressure reasons like `rate-limited`:

```ts
throw new IntegrationProviderError('rate-limited', message, retryAfterSeconds);
```

### Translating to HTTP responses (`presentation`)

The presentation/request boundary is the only place that turns errors into
client responses. Route `errorHandler`s are the default place to translate
known domain errors to `ClientError`; re-throw anything you don't recognize so
it reaches the global handler:

```ts
errorHandler: (error) => {
  if (error instanceof WorkspaceNotFoundError)
    throw new ClientError('Workspace not found', 'not-found', {status: 404});
  if (error instanceof LastMemberError)
    throw new ClientError(error.message, 'last-member', {status: 409});
  throw error; // unrecognized → global handler
},
```

`ClientError(message, code, params)` is the only error that produces a
structured client response. `code` is a stable kebab-case string (`not-found`,
`last-member`, `project-already-exists`). `params`:

- `status`: HTTP status, **defaults to 400**; set it for any other 4xx.
- `details`: structured data **returned to the client** (snake_case keys).
- `data`: context **logged only**, never sent to the client.
- `cause`: pass the original error when wrapping, so it stays in the chain for
  logs and diagnostics. Sentry sees unknown errors that reach the global handler;
  handled cases must capture explicitly if they need Sentry reporting.

For external errors, map the `reason` enum to a status and client code here
(e.g. `rate-limited` → 429).

### The global handler

The shared handler in `@shipfox/node-fastify` is the last resort. It sends
`ClientError` as `{code, details?}` with its status, maps Fastify
validation/known errors to 4xx codes, and logs + reports unknown errors to
Sentry as a 500 `server-error`. Anything that reaches it untyped becomes an
opaque 500, so translate errors you can describe before they get here.

## Metrics & observability

Metrics are emitted through OpenTelemetry and scraped by Prometheus. All the
plumbing (the SDK, the Prometheus exporters, the meter providers) lives in
`@shipfox/node-opentelemetry`; an app turns it on once at startup (the API does
this in `apps/api/src/core/run.ts`) and feature packages only define and record
instruments. Never add a metrics SDK or exporter to a feature package.

The worked example is `libs/api/runners/src/metrics`. Copy its shape.

### Two planes: instance vs service

There are two separate meter providers on two ports, and the choice between
them is about *what the number means*, not convenience.

- **Instance metrics** (`instanceMetrics.getMeter(name)`, port 9464) are
  counters and histograms recorded inline as an event happens: a job claimed,
  a request served, a duration observed. Each pod exposes its own values and
  Prometheus sums across pods. This is the default; reach for it first.
- **Service metrics** (`getServiceMetricsProvider().getMeter(name)`, port 9474)
  are observable gauges that read shared state (a queue depth, a backlog size,
  a current count) through a callback that runs on each scrape. They live on a
  separate provider because every pod reading the same database row would report
  the same value, and Prometheus must not sum those copies. Use a service gauge
  only for point-in-time state derived from shared storage.

If you are counting things that happen, you want an instance counter. If you are
reporting how many things currently exist, you want a service gauge.

### Package layout

Each feature package that emits metrics owns a `src/metrics/` folder:

```text
src/metrics/
  instance.ts   Counters and histograms, created at module load, recorded inline.
  service.ts    register<Module>ServiceMetrics(): observable gauges (omit if none).
  index.ts      Re-exports the above.
```

Instance instruments are created at the top of `instance.ts` and exported, then
imported and recorded where the event occurs. Creating them at import time is
safe for tests: `instanceMetrics.getMeter` returns a no-op meter until an app
starts instrumentation, so a test that merely imports the module records nothing
and binds nothing.

That same lazy resolution is a production trap. The metrics API has no proxy
meter (unlike traces, which back-fill), so an instrument created before the app
registers the global meter provider stays a no-op forever and never exports. The
app must therefore start instance instrumentation **before** the module graph
loads: preload it via `--import`, not from inside `run()`. See
`apps/api/src/instrumentation.ts` (wired into the Dockerfile CMD and the dev
script). A new app that calls `startInstanceInstrumentation` in-process after
importing its feature modules will silently emit nothing.

Service gauges are different. Reaching `getServiceMetricsProvider()` binds the
metrics port, so it must never run at import time; it would break any unit test
that imports the module. Fetch the meter, create the gauges, and attach their
callbacks **inside** an exported `register<Module>ServiceMetrics()` function.
Wire that function to the module via the `metrics` hook:

```ts
export const runnersModule: ShipfoxModule = {
  name: 'runners',
  // ...
  metrics: registerRunnersServiceMetrics,
};
```

`registerModuleMetrics` (called once from the app bootstrap, after
`startServiceMetrics` and `initializeModules`) invokes every module's hook. A
package with no shared-state gauge omits `metrics` entirely.

### Naming

Snake_case, prefixed with the module name: `runners_job_claimed`,
`runners_pending_jobs`, `runners_claim_duration`. The prefix is the namespace;
it keeps `workflows_*` and `runners_*` from colliding in one Prometheus tenant.

Do not hand-append `_total` to counters or unit suffixes to histograms: the
Prometheus exporter derives `_total`, `_milliseconds`, and friends from the
instrument kind and its `unit`. Set `unit: 'ms'` and `advice.explicitBucketBoundaries`
on histograms; the name stays unit-free.

### Cardinality is the one rule that matters

A metric label multiplies into one time series per distinct value. Labels must
be **bounded and low-cardinality**: an outcome, a reason, a type, a conclusion,
a provider, an OS: values you could list on one hand or one page.

Never label a metric with an unbounded identifier: no `jobId`, `runId`,
`workspaceId`, `organizationId`, `userId`, raw URL, or error message. One job ID
in a label is one new time series per job forever; it melts Prometheus and the
bill. When you need per-entity detail, that is what logs and traces are for;
put the ID in a `logger()` field, not a metric label.

Type the label set so the shape is enforced at every call site:

```ts
const jobClaimedCount = meter.createCounter<{outcome: 'claimed' | 'empty'}>(
  'runners_job_claimed',
  {description: 'Job-claim attempts by outcome'},
);
```

### Where recording lives

Metrics are observability, like logging, so they are allowed in `core` and `db`;
record where the event is known most precisely, not only at the HTTP edge.
Keep recording out of pure row-to-domain mappers and DTO converters. A service
gauge's callback queries through the same `db/` functions the rest of the
package uses; it does not reach for raw Drizzle.

## Design System

Before an agent creates or changes a visual or UI decision, read
[DESIGN.md](DESIGN.md). It owns the shared design system and points to the
code that owns exact token and component values.
