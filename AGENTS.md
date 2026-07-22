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

### E2E testing

Read [e2e/README.md](e2e/README.md) before adding or reshaping E2E tests. It is
the source of truth for suite levels, setup rules, screens, granularity,
dependency boundaries, and debugging.

Load-bearing rules:

- E2E setup must stay HTTP-first. Add module-owned setup routes under
  `/__e2e/<module>` and wrap them in `@shipfox/e2e-setup-*` helpers; do not
  create E2E data through direct database access.
- Put browser locators, navigation, waits, and visual normalization behind
  `@shipfox/e2e-screens-*` or `@shipfox/e2e-kit/ui` methods, not inline in
  specs.
- Granularity is review-enforced: one test proves one behavior, and one file
  covers one surface or one journey.

Each E2E package must also declare an explicit workspace dependency on the package
it verifies, such as `@shipfox/client-auth` for `@shipfox/e2e-client-auth`, so
Turbo includes the referenced package in the task DAG.

### Running the flow workflow E2E suite

`@shipfox/e2e-flow-workflows` (`e2e/suites/flow/workflows`) is the full-loop
suite. Each scenario pushes a real `workflow.yml` to Gitea and asserts on public
run and log APIs after webhook delivery, definition sync, trigger dispatch,
Temporal orchestration, a local source runner, and step execution. See
`e2e/suites/flow/workflows/README.md` for the scenario format and deep runbook.

The pure `expect.yaml` evaluator has Vitest node tests that need no infrastructure:

```sh
turbo test --filter=@shipfox/e2e-flow-workflows
```

The full loop needs the Docker services, then the repo E2E harness:

```sh
# 1. Local services (postgres, temporal, garage, gitea).
docker compose up -d            # Conductor worktrees: node dev/worktree-services.mjs up

# 2. Start the API/client dev servers and run the suite.
mise run e2e -- --filter=@shipfox/e2e-flow-workflows
```

The `e2e` mise task reads Conductor worktree ports from `.context/local-services/env`,
starts the API with E2E routes enabled, starts the client with the test VCS provider
enabled, waits for both to become ready, then runs `turbo test:e2e`. Diagnostics
land in `.context/shipfox-e2e-logs/`; flow runner logs are attached to failed
scenario results.

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

### Test structure: Arrange / Act / Assert

Each test is written in three clearly separated phases, in order:

1. **Arrange**: declare all data and preconditions needed for the test.
2. **Act**: call the function or trigger the behaviour under test.
3. **Assert**: verify the outcome.

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
// bad: act collapsed into assert (AAA violation)
expect(await terminateRunner(runner.id)).toBeDefined();

// good
const result = await terminateRunner(runner.id);
expect(result).toBeDefined();
```

If a test needs assertions in multiple places it is likely testing more than one thing; split it.

### Test isolation

- Each `describe` block generates a fresh `organizationId` (or other scope key) via `faker` in `beforeEach` so tests don't share data.
- `vi.restoreAllMocks()` is called automatically in `afterEach`; no need to do it manually.
- DB state is cleaned by truncating tables in `globalSetup`, not between individual tests. A module's `globalSetup` may only truncate tables owned by that module, so avoid relying on an empty DB mid-suite.
- Do not truncate from individual test files. Scope test data with fresh identifiers such as `projectId`, `workspaceId`, `organizationId`, or another module-owned key per test, and filter reads/assertions to that scope.

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

## Storybook story structure

Story files should be ordered for exploration first, broad visual coverage
second, composition coverage third, and interaction tests last.

Start every component story file with `Playground` when the component can be
rendered as a single basic example. `Playground` shows the neutral/default
component and exposes Storybook controls for meaningful visual and content props.
Rename old `Default` stories to `Playground` unless the story is not an
interactive playground.

After `Playground`, group variant axes into as few stories as practical. Prefer
matrix stories such as `Variants`, `Sizes`, `States`, `Content`, `Errors`, or
`DataStates` that render rows/columns of related states in one canvas. Do not add
one screenshot-producing story per enum value when a grouped matrix can show the
same coverage.

Put composition stories after variant matrices. Name them `Compositions` or with
a specific scenario name, and group related complex scenarios in one canvas when
that keeps Argos coverage clear and cheaper.

Put pure test stories last. Use `play` for assertions or interactions that prove
behavior, not for visual states that can be rendered directly with args or
fixtures. Prefix test-only exports with `Test` or give them a `Tests / ...`
display name so they are easy to distinguish from visual coverage.

## Visual Regression Testing

Argos catches UI drift on every PR via one named build per source package. The
`buildName` is the package name without the `@shipfox/` scope:

- `react-ui`: `@shipfox/react-ui` stories captured in **light + dark** by `@storybook/addon-vitest` + `@argos-ci/storybook/vitest-plugin`. Capture is part of `turbo test` for `@shipfox/react-ui`. It is the theming source of truth, so it is the only build that snapshots every story in both themes.
- `client-workflows`: `@shipfox/client-workflows` stories, captured the same way under `turbo test` for that package. Story-based capture isn't limited to `react-ui`: any client package with stories can register its own `argosVitestPlugin` build named after the package. Feature (`client-*`) builds capture the primary **dark** theme only; keep their `parameters.argos.modes` to `dark` since `react-ui` already proves theme correctness.
- `client-auth`: `@shipfox/client-auth` Storybook stories, captured the same way under `turbo test` for that package. Today this covers workspace switcher states in dark without full workspace E2E setup.
- `e2e-client-<module>` (today: `e2e-client-auth`): explicit `argosScreenshot(page, '<surface>/<state>')` calls in the matching `e2e/suites/client/<module>/*` Playwright specs. Each E2E package sets its own `buildName` matching the package name without the `@shipfox/` scope so PR checks stay scoped per surface. Place the call **after** the assertions that prove the page reached the expected state; the helper waits for fonts and layout, not for content you have not asserted on.

A surface with both Storybook and E2E visual coverage gets two standalone builds
in the same Argos project, one for the client package and one for the E2E
package. Do not merge them with Argos parallel or sharded builds. Visual capture
stays under the cached `test` task; do not split it into `test:visual`.

To cover a component state a single render cannot reach (error states, populated lists, etc.), add it as a new story rather than driving interactions in `play`. To cover a new page state, add an `argosScreenshot` call in the existing test that already drives there; do not write a screenshot-only spec.

`ARGOS_TOKEN` and `CI` are passed through Turbo via `globalPassThroughEnv` in `turbo.jsonc`. If you add another env var the visual flow needs, allowlist it there or Turbo will silently strip it. See `CONTRIBUTING.md#visual-regression-testing` for the longer walkthrough.

## Design System

Before an agent creates or changes a visual or UI decision, read
[DESIGN.md](DESIGN.md). It owns the shared design system and points to the
code that owns exact token and component values.
