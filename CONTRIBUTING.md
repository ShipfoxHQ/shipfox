# Contributing

This project and everyone participating in it are governed by the Code of
Conduct which can be found in the file [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
By participating, you are expected to uphold this code.

## Prerequisites

- [mise](https://mise.jdx.dev/): manages tool versions (Node.js, pnpm, [Turbo](https://turbo.build/))
- [Docker](https://docs.docker.com/get-docker/): runs local service dependencies (PostgreSQL, etc.)

## Getting Started

### Install tooling

[mise](https://mise.jdx.dev/) reads `mise.toml` and installs the correct versions of Node.js, pnpm, and Turbo.

```sh
mise install
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

Start the API and client before running E2E tests:

```sh
docker compose up -d
pnpm --filter=@shipfox/api dev
pnpm --filter=@shipfox/client dev
```

Local E2E defaults are set up for the standard dev ports. The API `.env`
enables E2E routes with the local admin key, and the client `.env` points at
the local API. Then run E2E packages directly:

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

## Visual Regression Testing

Visual drift is caught on every PR via [Argos](https://argos-ci.com/). One Argos
project receives one named build per source module (`react-ui` for the
component library, `client-auth` for the auth E2E surface, etc.) using Argos's
[build-splitting](https://argos-ci.com/docs/build-splitting); each posts its own
GitHub check.

### What's covered

| Build name | Source | Captured |
| --- | --- | --- |
| `react-ui` | `@shipfox/react-ui` stories via `@storybook/addon-vitest` + `@argos-ci/storybook/vitest-plugin` | every story in **light + dark** (declared in `libs/shared/react/ui/.storybook/preview.tsx` as `parameters.argos.modes`) |
| `client-auth` | `@shipfox/e2e-client-auth` Playwright specs via `@argos-ci/playwright` reporter | explicit `argosScreenshot()` calls at user-visible checkpoints |

The goal is review-grade signal on UI drift, not 100% state coverage. Capture the
states a reviewer would want to eyeball on a PR; skip anything that re-renders
the same DOM as a covered state.

### Run locally

Library capture is part of the standard test task — useful when iterating on a
component:

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
under `src/**` automatically and the Argos vitest plugin captures each one in
both themes. To cover a state that a single render can't reach (e.g. error
states, populated lists), add it as a new story rather than driving
interactions in `play`.

### Add a new client-page snapshot

In an `e2e/client/<feature>` spec:

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

New `e2e/client/*` packages register their own Argos reporter in their
`playwright.config.ts` with a `buildName` that matches the package suffix
(e.g. `e2e/client/auth` → `'client-auth'`, `e2e/client/projects` →
`'client-projects'`). One named Argos build per E2E module keeps PR checks
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
