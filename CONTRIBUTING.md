# Contributing

This project and everyone participating in it are governed by the Code of
Conduct which can be found in the file [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
By participating, you are expected to uphold this code.

## Prerequisites

- [mise](https://mise.jdx.dev/): manages tool versions (Node.js, pnpm, [Turbo](https://turbo.build/), Ollama)
- [Docker](https://docs.docker.com/get-docker/): runs local service dependencies (PostgreSQL, etc.)

## Getting Started

### Install tooling

[mise](https://mise.jdx.dev/) reads `mise.toml` and installs the correct versions of Node.js, pnpm, Turbo, and Ollama.

```sh
mise install
```

Use mise-managed tools directly after activation, or through `mise exec` in
non-interactive scripts:

```sh
mise exec -- pnpm install
mise exec -- turbo build
```

### Start local services

```sh
docker compose up -d
```

### Install dependencies and build

```sh
pnpm install
turbo build
```

Build a specific package and its dependencies:

```sh
turbo build --filter=@shipfox/api...
```

## Local Tooling

### Mise Tasks

The repository defines project tasks in `mise.toml`. List them with:

```sh
mise tasks
```

Mise tasks are safe to run from the main checkout or from a Conductor worktree.
When a task needs the main checkout, it detects `CONDUCTOR_ROOT_PATH` and
delegates to `mise -C "$CONDUCTOR_ROOT_PATH" run <task>`.

### Shared Ollama

Ollama is installed by mise and is used as a shared local service. It is started
from the main checkout, not from each Conductor worktree, because the server is
heavy and stateless.

Conductor setup runs this automatically for local workspaces:

```sh
mise run ollama:up
```

From a worktree, that task delegates to the root checkout and runs the root
`ollama:up` task. From the root checkout, it starts `ollama serve`, pulls
`smollm2:135m-instruct-q2_K`, and then reports the API as ready. A background warmup request
preloads the model with a 24 hour keep-alive, so callers can start using the
Ollama HTTP API as soon as the pull completes.

Useful commands:

```sh
mise run ollama:up       # start the shared server and pull smollm2:135m-instruct-q2_K
mise run ollama:status   # show endpoint, root path, and managed process status
mise run ollama:stop     # stop the server if this repo started it
```

The helper stores process state and logs under:

```text
$CONDUCTOR_ROOT_PATH/.context/shared-ollama/
```

The default endpoint is `http://127.0.0.1:11434`. Override it only when needed:

```sh
SHIPFOX_OLLAMA_BASE_URL=http://127.0.0.1:11500 mise run ollama:up
SHIPFOX_OLLAMA_MODEL=other:model mise run ollama:up
SHIPFOX_OLLAMA_KEEP_ALIVE=2h mise run ollama:up
```

### Conductor Worktree Services

Conductor workspaces run `dev/worktree-services.mjs up` during setup. This
creates per-worktree Docker services, assigns ports from `CONDUCTOR_PORT`, and
writes the generated app environment to `.context/local-services/env`, which is
loaded by `mise.toml`.

Common commands:

```sh
mise exec -- node dev/worktree-services.mjs status
mise exec -- node dev/worktree-services.mjs stop
mise exec -- node dev/worktree-services.mjs destroy
```

`destroy` removes the worktree Docker volumes and generated local-service state.
The shared Ollama service is intentionally not stopped during workspace archive.

## Directory Structure

```
apps/           Application packages (deployable services)
libs/           Library packages (shared code, published or internal)
tools/          Internal build tooling (SWC, TypeScript, Biome, Vitest wrappers)
```

Each package follows the same layout:

```
package/
  src/          Source code
  test/         Test factories and helpers
  dist/         Build output (git-ignored)
```

## Common Scripts

Available in most packages via `pnpm <script>`:

| Script       | Description                                     |
| ------------ | ----------------------------------------------- |
| `build`      | Transpile source with [SWC](https://swc.rs/)    |
| `dev`        | Start in watch mode with hot-reload (apps only) |
| `type`       | Type-check and emit declarations                |
| `lint`       | Check for lint errors                           |
| `lint:fix`   | Auto-fix lint errors                            |
| `format`     | Check formatting                                |
| `format:fix` | Auto-fix formatting                             |
| `test`       | Run tests once                                  |
| `test:watch` | Run tests in watch mode                         |

## Publishing & Changesets

`libs/` and `tools/` packages publish to npm under `@shipfox/*`. `apps/`,
`e2e/`, and the workspace root stay private.

Every non-trivial PR touching `libs/` or `tools/` needs a changeset. Pure
formatting or comment-only edits can skip it.

```sh
pnpm exec changeset          # humans
# agents: invoke the `generate-changeset` skill
```

Pick the bump: `patch` for fixes/refactors, `minor` for additive API, `major`
for breaking changes. Commit `.changeset/*.md` alongside the code.

Trigger `.github/workflows/publish-packages.yml` from the Actions tab to
publish.

## Turbo Tasks

[Turbo](https://turbo.build/) orchestrates tasks across the monorepo with caching and dependency ordering. Tasks are defined in `turbo.jsonc`:

| Task | Description |
| --- | --- |
| `turbo build` | Build all packages in dependency order |
| `turbo lint` / `turbo format` | Run checks across all packages |
| `turbo type` | Type-check all packages in dependency order |
| `turbo test` | Run tests across all packages |
| `turbo test:e2e` | Run Playwright E2E packages against a pre-started local stack |

`--filter` scopes a task to a specific package:

```sh
turbo build --filter=@shipfox/api...
turbo lint --filter=@shipfox/api-hello
```

## E2E Testing

E2E tests live under `e2e/` and mirror the application/library module structure.
They use [Playwright](https://playwright.dev/) and run against an already-started
local stack.

Start the local service dependencies, then use the repo E2E harness to start the
API/client dev servers and run Playwright:

```sh
docker compose up -d
mise run e2e -- --filter=@shipfox/e2e-client-auth
```

Agent E2E tests that validate custom model providers against local Ollama also
require the shared Ollama service and default model:

```sh
mise run ollama:up
mise run e2e -- --filter=@shipfox/e2e-client-agent
```

The harness writes API/client logs and failure diagnostics to
`.context/shipfox-e2e-logs/` locally. It also reads Conductor worktree ports from
`.context/local-services/env` through mise, so the same command works in worktrees.
If the API and client are already running, run E2E packages directly:

```sh
turbo test:e2e --filter=@shipfox/e2e-client-auth
```

E2E setup APIs are module-owned routes under `/__e2e/<module>`. They are mounted only
when both `E2E_ENABLED=true` and `E2E_ADMIN_API_KEY` are set. Tests must create data
through these HTTP APIs, not through direct database access.

## Unit Testing Strategy (Client Apps)

Client tests should default to the cheapest environment that can prove the
behavior under test. React Testing Library is useful for DOM behavior, but it is
too expensive for schema validation, request payload shaping, error-copy mapping,
redirect sanitization, cache key generation, or other pure decisions.

When adding or refactoring client tests:

1. Put pure behavior in plain TypeScript helpers and test it in Vitest's `node`
   environment. Examples include form parsing, DTO normalization, auth error
   copy, URL sanitization, and token timing helpers.
2. Keep React Testing Library for behavior that requires rendered React state:
   provider wiring, hooks interacting with React Query/Jotai, focus/portal/menu
   behavior, StrictMode idempotency, and a small number of page smoke tests.
3. Move full user journeys to Playwright E2E instead of reproducing them through
   a memory router, auth provider, query client, API mocks, and toast container in
   every unit test.
4. Avoid asserting schema details or exact request payloads in RTL page tests when
   a Node helper test can cover the same branch directly.
5. Avoid real timers in unit tests. Prefer immediate promises, fake timers, or
   explicitly controlled promises over `setTimeout` sleeps.
6. Use `fireEvent.change` for simple final-value form setup. Use
   `userEvent.type` only when keyboard-level interaction semantics are the thing
   being tested.

Client packages that mix pure tests and DOM tests should split Vitest projects so
`.test.ts` files can run in `node` without `test/setup.ts`, while `.test.tsx`
files and browser-storage tests run in `jsdom`:

```typescript
export default defineConfig(
  {
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'node',
            environment: 'node',
            include: ['src/**/*.test.ts'],
            exclude: ['src/state/local-storage-backed.test.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: 'dom',
            environment: 'jsdom',
            include: ['src/**/*.test.tsx', 'src/state/local-storage-backed.test.ts'],
            setupFiles: ['test/setup.ts'],
          },
        },
      ],
    },
  },
  import.meta.url,
);
```

The target shape is many fast Node tests for branch-heavy behavior, a small RTL
suite for React integration, and Playwright for user-visible journeys.

### Render at the lowest altitude that proves the behavior

A page-level harness (memory router + `QueryClient` + configured API client, e.g.
`renderProjectPage` in `libs/client/*/test/pages.tsx`) is the heaviest way to
mount a component, and every import re-evaluates that provider stack. Pick the
lightest tier that can still exercise what the test asserts:

| Tier | Use it for | How |
| --- | --- | --- |
| `node` test | Pure decisions: filtering, formatting, URL/search-param shaping, status mapping. | Extract a helper, test it in the `node` project (`*.test.ts`, no DOM). |
| `render()` | A presentational component that takes all its data through props and renders no router-aware child. | `render(<Component {...props} />)` from `@testing-library/react`, no providers. |
| `renderWithRouter()` | A component that needs a router in context (its rows render `<Link>`, or it calls `useNavigate`) but fetches nothing. | A router-only helper (e.g. `libs/client/workflows/test/render.tsx`): memory router, no `QueryClient` or API client. |
| Page harness | A page, or a component that genuinely fetches and navigates (React Query hooks + `useNavigate`). | `renderProjectPage` / the package's `test/pages.tsx`. |

A page keeps a handful of harness-based smoke tests; it should not carry dozens of
assertions that each remount the world when a lower tier proves the same branch.

**Enforcement.** Harness usage must be justified in review, and a package that
uses the page harness pins its harness importers with an allowlist guard test (see
`libs/client/workflows/src/page-harness-budget.test.ts`). A new `#test/pages`
import fails the guard until it is added to the allowlist, which is the moment a
reviewer asks whether the test needs page wiring or should drop an altitude.

## Visual Regression Testing

Visual drift is caught on every PR via [Argos](https://argos-ci.com/). One Argos
project receives one named build per source package (`react-ui` for
`@shipfox/react-ui`, `client-auth` for `@shipfox/client-auth`,
`e2e-client-auth` for `@shipfox/e2e-client-auth`, etc.) using Argos's
[build-splitting](https://argos-ci.com/docs/build-splitting). Each build posts
its own GitHub check, and a surface with both Storybook and E2E coverage gets
two standalone builds in the same Argos project. Do not merge those captures
through parallel or sharded Argos builds.

### What's covered

| Build name | Source | Captured |
| --- | --- | --- |
| `react-ui` | `@shipfox/react-ui` stories via `@storybook/addon-vitest` + `@argos-ci/storybook/vitest-plugin` | every story in **light + dark** (declared in `libs/shared/react/ui/.storybook/preview.tsx` as `parameters.argos.modes`) |
| `client-workflows` | `@shipfox/client-workflows` stories via `@storybook/addon-vitest` + `@argos-ci/storybook/vitest-plugin` | every story in **dark** (declared in `libs/client/workflows/.storybook/preview.tsx` as `parameters.argos.modes`) |
| `client-auth` | `@shipfox/client-auth` stories via `@storybook/addon-vitest` + `@argos-ci/storybook/vitest-plugin` | workspace switcher states in **dark** (declared in `libs/client/auth/.storybook/preview.tsx` as `parameters.argos.modes`) |
| `e2e-client-auth` | `@shipfox/e2e-client-auth` Playwright specs via `@argos-ci/playwright` reporter | explicit `argosScreenshot()` calls at user-visible checkpoints |

`react-ui` is the theming source of truth, so it captures every story in **light
and dark**. Feature packages (`client-*`) compose those primitives, so they
capture only the product's primary **dark** theme: theme correctness is already
proven upstream in `react-ui`, and one theme per feature story roughly halves the
Argos screenshots those builds cost. Keep new `client-*` `parameters.argos.modes`
to `dark` only; reach for a second theme in a feature package only when it renders
theme-specific markup that `react-ui` does not already cover.

The goal is review-grade signal on UI drift, not 100% state coverage. Capture the
states a reviewer would want to eyeball on a PR; skip anything that re-renders
the same DOM as a covered state.

### Run locally

Storybook capture is part of the standard cached `test` task, not a separate
`test:visual` task. That keeps cache policy consistent while Argos build names
keep review surfaces separate. It is useful when iterating on a component:

```sh
turbo test --filter=@shipfox/react-ui
```

This runs Vitest in browser mode against every story, producing PNGs in
`libs/shared/react/ui/screenshots/` (gitignored). No `ARGOS_TOKEN` is needed
locally; the `argosVitestPlugin` only uploads when `process.env.CI` is set.

Page snapshots ride on the existing E2E flow — when you run
`turbo test:e2e --filter=@shipfox/e2e-client-auth` locally without `CI=true`,
the Argos reporter is not active, so no screenshots are uploaded.

### Add a new component snapshot

Just add a story. `@storybook/addon-vitest` discovers `.stories.@(js|jsx|ts|tsx|mdx)`
under `src/**` automatically and the Argos vitest plugin captures each one in the
themes that package's `parameters.argos.modes` declares (light + dark in
`react-ui`, dark only in feature packages). To cover a state that a single render
can't reach (e.g. error states, populated lists), add it as a new story rather
than driving interactions in `play`.

### Add a new client-page snapshot

In an `e2e/suites/client/<feature>` spec:

```ts
import {argosScreenshot} from '@shipfox/playwright';

test('shows the empty state for new workspaces', async ({page, auth}) => {
  // ...drive UI to the state you want to verify...
  await expect(page.getByRole('heading', {name: 'No projects yet'})).toBeVisible();
  await argosScreenshot(page, 'projects/empty-state');
});
```

Conventions:

- Snapshot **after** the assertions that prove the page reached the expected
  state — `argosScreenshot` waits for fonts and stable layout, but it cannot
  wait for content you have not asserted on.
- Name snapshots `<surface>/<state>` (e.g. `auth/login`,
  `projects/empty-state`). The directory-style prefix groups related shots in
  the Argos UI.
- Keep any generated entity data that is visible in a screenshot deterministic.
  Random users, IDs, and hidden setup data are fine for isolation, but names,
  titles, and other rendered text should use fixed values so Argos only reports
  meaningful UI drift.

New `e2e/suites/client/*` packages register their own Argos reporter in their
`playwright.config.ts` with a `buildName` that matches the package name without
the `@shipfox/` scope (e.g. `@shipfox/e2e-client-auth` →
`'e2e-client-auth'`, `@shipfox/e2e-client-projects` →
`'e2e-client-projects'`). One named Argos build per E2E module keeps PR checks
scoped: a regression in the auth flow doesn't taint the review surface for
projects.

### Reviewing drift

When a PR diff is non-trivial, both Argos checks may flip from green to "review
required". Open the Argos build, mark each diff as accepted (intentional UI
change) or rejected (regression). Approving a build updates the baseline once
the PR merges to `main`.

### Plumbing files

- `libs/shared/react/ui/vitest.config.ts` — defines the `storybook` Vitest
  project that wraps stories with `storybookTest()` and `argosVitestPlugin()`.
  The plugin writes PNGs to `screenshots/` and uploads when `process.env.CI`
  is set.
- Client packages with Storybook use the same `storybook` Vitest project shape,
  name the Argos build after their package without the `@shipfox/` scope, and
  include a package-level `vercel.json` for Storybook deployment.
- `turbo.jsonc` `globalPassThroughEnv` includes `ARGOS_TOKEN` and `CI` so
  the Vitest plugin and Playwright reporter actually receive them when run
  through Turbo. If you add another env var the visual flow needs (e.g. a
  custom reference-branch override), allowlist it here.

## Import Aliases

Packages use Node.js [subpath imports](https://nodejs.org/api/packages.html#subpath-imports) (`imports` field in `package.json`) instead of TypeScript `paths`:

| Pattern | Maps to | Example |
| --- | --- | --- |
| `#*` | `./src/*` | `import {foo} from '#core/foo.js'` |
| `#test/*` | `./test/*` | `import {bar} from '#test/factories/bar.js'` |

Node, TypeScript, and [Vitest](https://vitest.dev/) resolve these natively; no build-time rewriting needed.

## Development Workflow

Libraries (`libs/`) expose **conditional exports**:

| Condition | Resolves to | Used by |
| --- | --- | --- |
| `development` | TypeScript source (`src/`) | `pnpm dev`, editor |
| `default` | Built output (`dist/`) | `turbo build`, CI |

`pnpm dev` picks up library source changes immediately, no lib rebuild needed.
