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

## Visual Regression Testing

Visual drift is caught on every PR via [Argos](https://argos-ci.com/). One Argos
project receives two named builds per PR (`storybook` and `client-pages`) using
Argos's [build-splitting](https://argos-ci.com/docs/build-splitting); each posts
its own GitHub check.

### What's covered

| Surface | Source | Captured |
| --- | --- | --- |
| `storybook` build | `@shipfox/react-ui` stories via `@storybook/addon-vitest` + `@argos-ci/storybook/vitest-plugin` | every story in **light + dark** (declared in `libs/shared/react/ui/.storybook/preview.tsx` as `parameters.argos.modes`) |
| `client-pages` build | Playwright specs in `e2e/client/*` via `@argos-ci/playwright` reporter | explicit `argosScreenshot()` calls at user-visible checkpoints |

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

New `e2e/client/*` packages do not need any extra Argos wiring — the reporter
is registered in each package's `playwright.config.ts` (currently mirrored from
`e2e/client/auth/playwright.config.ts`). If you add a new client E2E package,
copy that config including the reporter array and the `buildName: 'client-pages'`
option so the captures end up in the same Argos build.

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
- `libs/shared/react/ui/.storybook/vitest.setup.ts` — adds a Framer Motion
  `MotionConfig reducedMotion="always"` decorator on top of the regular
  `preview.tsx` annotations, so animations are quiet during capture.
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
