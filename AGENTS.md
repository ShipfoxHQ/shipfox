# Agent guidelines

Read [CONTRIBUTING.md](CONTRIBUTING.md) before working on this project.

## Running tasks locally

This project uses [mise](https://mise.jdx.dev/) to manage tool versions. `node`, `pnpm`, and `turbo` are all available in the shell — no `npx` needed.

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

Do not add `@tanstack/zod-form-adapter` or write custom Zod adapters — the
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
errors only after the field has been blurred or after a submit attempt — see
the `fieldError(field)` helper at the bottom of each page form for the
boilerplate.

Server errors are classified by a per-feature `errorToFormError(error)` pure
function in `form-errors.ts`. It returns either
`{kind: 'field', field, message}` (routed to
`form.setFieldMeta(field, prev => ({...prev, errorMap: {...prev.errorMap, onServer: message}}))`)
or `{kind: 'form', message}` (rendered in an `<Alert>` above the form).
Use the `onServer` slot in `errorMap` — not `errors` directly — because
TanStack Form v1 derives `field.state.meta.errors` from `errorMap`, so a
direct write to `errors` gets overwritten on the next derived read.
TanStack Form auto-clears `errorMap.onServer` on the next field validation
(blur/change), which is the correct UX. Add a Vitest node test enumerating
every `ApiError` code the feature handles, plus the unknown-error fallback.

For draft persistence across navigation (auth flows), sync TanStack Form values
into a Jotai atom on field blur and on form unmount only — never on every
keystroke — and filter the atom shape explicitly so unrelated fields (e.g.
signup's `name`) don't leak into a `{email, password}` draft.

### E2E setup

E2E setup must stay HTTP-first. Add module-owned setup routes under
`/__e2e/<module>` and wrap them in `@shipfox/e2e-helper-*` helpers; do not create
E2E data through direct database access.

Each E2E package must also declare an explicit workspace dependency on the package
it verifies, such as `@shipfox/client-auth` for `@shipfox/e2e-client-auth`, so
Turbo includes the referenced package in the task DAG.

### Configuration

Each app and each package that reads the environment owns a `src/config.ts`. It
calls `createConfig` from `@shipfox/config` (a thin wrapper over envalid) with one
validator per variable: `str`, `num`, `bool`, `host`, `port`, `url`, or `email`. A
validator with a `default` is optional; one without a default is required, so a
missing value fails startup. Keep the file flat: declare the schema, then derive
any helpers (such as a mailer) below it.

Document every variable with the validator's `desc` property, never a `//` comment
beside it. `desc` is part of envalid's output, so it reaches the operators who
self-host the service; a comment never leaves the source file. When you find an
existing `//` note on a config param, move it into `desc`.

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

### Use JSDoc for documentation, not narration

Reserve `/** ... */` for the public API of shared packages (exported functions,
types, and config that other packages consume), where editor hover-docs add real
value. Document parameters and behaviour that the signature can't convey; do not
restate the type or the name:

```ts
/**
 * Verifies an HS256-signed token and validates its payload against `schema`.
 * Rejects any token whose `alg` header is outside the HS256 allowlist.
 *
 * @param audience - When set, jose rejects an `aud` mismatch before the schema runs.
 */
```

Skip JSDoc entirely on internal, app-local, or self-evident functions; a
docstring that only echoes `getRunner(id): Runner` is noise.

### Keep planning and process out of the source

No `// TODO`, `// v1 only`, `// added in follow-up PR`, or references to
planning-doc decisions (`/plan-eng-review A1`) in module or function headers.
Speculation about future work ("today X, tomorrow Y") and tracked tasks belong in
`TODOS.md`, the issue tracker, or the design doc, not in code that outlives them.

## Error handling

Error handling is a cross-layer concern, not an HTTP detail. The guiding
principle is **let errors bubble up and translate them only when crossing a
boundary**. Each layer owns one job, and the error changes shape only at the
edges:

```
external system  →  api/core: typed error  →  presentation: ClientError  →  global handler  →  HTTP response
```

Never swallow or wrap an error unless you add meaning. If you can re-throw
as-is, do. Do not catch errors just to log them — let unknowns reach the global
handler.

### Domain errors (`core` / `db`)

Throw typed domain errors from domain and persistence code. Define them in
`core/errors.ts` as plain `Error` subclasses with a human-readable message, a
`name`, and any context as public readonly fields. They carry **no HTTP
concerns** (no status, no client-facing code) — that keeps them reusable by
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

- `status` — HTTP status, **defaults to 400**; set it for any other 4xx.
- `details` — structured data **returned to the client** (snake_case keys).
- `data` — context **logged only**, never sent to the client.
- `cause` — pass the original error when wrapping, so it stays in the chain for
  logs and diagnostics. Sentry sees unknown errors that reach the global handler;
  handled cases must capture explicitly if they need Sentry reporting.

For external errors, map the `reason` enum to a status and client code here
(e.g. `rate-limited` → 429).

### The global handler

The shared handler in `@shipfox/node-fastify` is the last resort. It sends
`ClientError` as `{code, details?}` with its status, maps Fastify
validation/known errors to 4xx codes, and logs + reports unknown errors to
Sentry as a 500 `server-error`. Anything that reaches it untyped becomes an
opaque 500 — so translate errors you can describe before they get here.

## Unit Testing Strategy (Client Apps)

The detailed client testing strategy lives in
[CONTRIBUTING.md](CONTRIBUTING.md#unit-testing-strategy-client-apps). In short:
keep pure behavior in Vitest `node` tests, reserve React Testing Library for
rendered React behavior, and move full user journeys to Playwright E2E.

## Unit Testing Strategy (Node Apps)

Tests use **Vitest** and run against a real PostgreSQL database, not mocks. The philosophy is to test against real infrastructure where possible and only mock external dependencies (feature flags, cloud provider APIs, etc.).

Each app has two databases: one for the app itself (named after the app, e.g. `api`) and a dedicated test database (named `<app>_test`, e.g. `api_test`). The test database is selected via `process.env` overrides in `test/env.ts`.

### Test infrastructure per package

```
test/
  globalSetup.ts   # Truncates all DB tables once before the suite runs
  setup.ts         # Opens/closes the PG connection per file; calls vi.restoreAllMocks() in afterEach
  env.ts           # Overrides process.env with test values (fake credentials, TZ=UTC, etc.)
  index.ts         # Re-exports all factories
  factories/       # One file per entity, using Fishery
```

`vitest.config.ts` points `globalSetup` at `test/globalSetup.ts` and `setupFiles` at `test/setup.ts`.

### Factories (Fishery)

Factories live in `test/factories/` and use **Fishery**. They provide sensible faker-based defaults and persist to the DB via their `onCreate` handler:

```typescript
// build in memory only
const runner = runnerFactory.build({ organizationId: "org-123" });

// persist to DB
const runner = await runnerFactory.create({ organizationId: "org-123" });

// build a list
const jobs = jobFactory.buildList(3);
```

Use `build()` for pure unit tests on `core/` logic; use `create()` when the code under test queries the DB.

### Test structure — Arrange / Act / Assert

Each test is written in three clearly separated phases, in order:

1. **Arrange** — declare all data and preconditions needed for the test.
2. **Act** — call the function or trigger the behaviour under test.
3. **Assert** — verify the outcome.

Keep a blank line between each phase so the boundary is immediately visible:

```typescript
it("marks the runner as terminated", async () => {
  const runner = await runnerFactory.create({ organizationId });

  await terminateRunner(runner.id);

  const updated = await getRunner(runner.id);
  expect(updated.latestEvent?.type).toBe("terminated");
});
```

Never interleave assertions with setup, fold the act into the arrange line, or inline the act inside an assertion. The act must always be assigned to a variable first:

```typescript
// bad — act collapsed into assert (AAA violation)
expect(await terminateRunner(runner.id)).toBeDefined();

// good
const result = await terminateRunner(runner.id);
expect(result).toBeDefined();
```

If a test needs assertions in multiple places it is likely testing more than one thing — split it.

### Test isolation

- Each `describe` block generates a fresh `organizationId` (or other scope key) via `faker` in `beforeEach` so tests don't share data.
- `vi.restoreAllMocks()` is called automatically in `afterEach` — no need to do it manually.
- DB state is cleaned by truncating tables in `globalSetup`, not between individual tests, so avoid relying on an empty DB mid-suite.

### Mocking

Keep mocking minimal. Only mock what cannot run in the test environment (external HTTP APIs, GCP clients, feature flag SDKs):

```typescript
vi.mock("@shipfox/node-feature-flag", () => ({
  getStringFeatureFlag: vi.fn().mockResolvedValue("gcp"),
}));
```

### Testing Fastify routes

Create a fresh `fastify()` instance per `describe` block, register only the route under test, and use `.inject()`:

```typescript
describe("listRunners", () => {
  const app = fastify();
  beforeAll(() => {
    app.register(listRunnersRoute);
  });

  it("returns runners for an organization", async () => {
    const runner = await runnerFactory.create({ organizationId });

    const res = await app.inject({
      method: "GET",
      path: "/",
      query: { organizationId },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runners).toHaveLength(1);
  });
});
```

### Parameterised tests

Use `describe.each` / `it.each` for exhaustive coverage over enum values or similar sets:

```typescript
describe.each(runnerEventTypeEnum.enumValues)('createRunnerEvent "%s"', (eventType) => {
  it('persists the event', async () => { ... });
});
```

## Visual Regression Testing

Argos catches UI drift on every PR via one named build per source module:

- `react-ui` — `@shipfox/react-ui` stories captured in **light + dark** by `@storybook/addon-vitest` + `@argos-ci/storybook/vitest-plugin`. Capture is part of `turbo test` for `@shipfox/react-ui`. Adding a new story snapshots automatically in both themes.
- `client-<module>` (today: `client-auth`) — explicit `argosScreenshot(page, '<surface>/<state>')` calls in the matching `e2e/client/<module>/*` Playwright specs. Each E2E package sets its own `buildName` matching the package suffix so PR checks stay scoped per surface. Place the call **after** the assertions that prove the page reached the expected state — the helper waits for fonts and layout, not for content you have not asserted on.

To cover a component state a single render cannot reach (error states, populated lists, etc.), add it as a new story rather than driving interactions in `play`. To cover a new page state, add an `argosScreenshot` call in the existing test that already drives there; do not write a screenshot-only spec.

`ARGOS_TOKEN` and `CI` are passed through Turbo via `globalPassThroughEnv` in `turbo.jsonc`. If you add another env var the visual flow needs, allowlist it there or Turbo will silently strip it. See `CONTRIBUTING.md#visual-regression-testing` for the longer walkthrough.

## Design System

Always read [DESIGN.md](DESIGN.md) before making any visual or UI decisions. Token
families, font choices, color usage, spacing conventions, and surface-level guidance
(DAG view, log tails, status pills, runner tables, etc.) are all defined there.

Two conventions trip up newcomers and must be enforced in review:

1. **Spacing base is 1px.** `p-4` is 4px, not 16px. The Tailwind class names map
   directly to pixels because `index.css` sets `--spacing: 1px`.
2. **Brand orange is the focus ring and interactive highlight, not the primary
   CTA fill.** The default primary button is inverted neutral. Reach for orange
   for focus states, links, and "this is where you are" affordances only.

Do not deviate without explicit user approval and a corresponding entry in the
DESIGN.md decisions log.
