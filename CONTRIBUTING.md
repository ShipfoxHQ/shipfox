# Contributing

This project and everyone participating in it are governed by the Code of
Conduct which can be found in the file [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
By participating, you are expected to uphold this code.

## Prerequisites

- [mise](https://mise.jdx.dev/): manages tool versions (Node.js, pnpm, [Turbo](https://turbo.build/), Ollama)
- [Docker](https://docs.docker.com/get-docker/): runs local service dependencies (PostgreSQL, etc.)

## Getting Started

### Install tooling and dependencies

[mise](https://mise.jdx.dev/) reads `mise.toml` and installs the correct versions
of Node.js, pnpm, Turbo, and Ollama.

Install the pinned tools and workspace dependencies:

```sh
mise install
mise exec -- pnpm install
```

### Start services and build

```sh
docker compose up -d
mise exec -- turbo build
```

This creates a working local checkout. Use `mise exec --` for shell scripts and
automation. Run `mise tasks` to discover repository tasks.

## Normal contribution workflow

Make a focused change. Run the smallest relevant validation before opening a
pull request. Read the [local development and release workflow guide](docs/guides/local-development-and-release-workflow.md)
when you need task selection, Conductor or Ollama recovery, affected-package
validation, or package release procedures.

If your contribution creates or changes a visual or interaction decision, read
the [design system](DESIGN.md). It owns shared design guidance and points to
the code that owns exact token and component values.

If you add, update, or exempt a dependency, read the
[dependency version policy](docs/policies/dependency-versions.md). It defines
version rules, exceptions, package families, and dependency checks.

## Client architecture

When you add or change a client feature, API adapter, query, route state, form,
atom, browser storage, or cross-feature client flow, read the
[client architecture guide](docs/architecture/client-architecture.md). It owns
the current client model, form rules, and architecture enforcement.

## Backend cross-cutting rules

When your change adds or changes an environment variable, validator, or
environment description, read the [configuration policy](docs/policies/configuration.md).
It owns repository-wide configuration rules.

When your change adds a domain or provider error, translates a request failure,
or reports an unexpected failure, read [error handling](docs/architecture/error-handling.md).
It owns the backend error model and reporting boundaries.

When your change adds a metric or changes instrumentation startup, naming,
units, or labels, read [observability](docs/architecture/observability.md). It
owns the backend metrics model and cardinality constraints.

When your change mints, verifies, or carries an authentication token, read the
[Auth security model](libs/api/auth/README.md#security-model). It owns token
authority, lifetime, trust boundaries, and logging constraints.

## Writing Documentation

All technical writing (docs pages, package READMEs, guides) follows
[WRITING.md](WRITING.md): structure for skimming, sentence and word rules, a
strict no-em-dash rule, and language-level targets with a readability script.
Docs-app pages additionally follow
[apps/docs/WRITING.md](apps/docs/WRITING.md).

## Directory Structure

```
apps/           Application packages (deployable services)
dev/            Local environment and Conductor workspace lifecycle
e2e/            E2E harness, fixtures, screens, and suites
libs/           Library packages (shared code, published or internal)
tools/          Internal build, policy, and release tooling
```

Each package follows the same layout:

```
package/
  src/          Source code
  test/         Test factories and helpers
  dist/         Build output (git-ignored)
```


## E2E Testing

E2E tests live under `e2e/` and use
[Playwright](https://playwright.dev/) against the local stack. The full authoring
guide is [`e2e/README.md`](e2e/README.md); it defines the suite levels, setup
rules, page-object rules, dependency boundaries, and review checklist.

Start the local service dependencies, then use the repo E2E harness to start the
API/client dev servers and run Playwright:

```sh
docker compose up -d
mise run e2e -- --filter=@shipfox/e2e-client-auth
```

The harness writes API/client logs and failure diagnostics to
`.context/shipfox-e2e-logs/` locally. It also reads Conductor worktree ports from
`.context/local-services/env` through mise, so the same command works in worktrees.
If the API and client are already running, run E2E packages directly:

```sh
turbo test:e2e --filter=@shipfox/e2e-client-auth
```

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

Page snapshots ride on the existing E2E flow. When you run
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
  state. `argosScreenshot` waits for fonts and stable layout, but it cannot
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

- `libs/shared/react/ui/vitest.config.ts`: defines the `storybook` Vitest
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
| `workspace-source` | TypeScript source (`src/`) | `pnpm dev`, editor, tests |
| `default` | Built output (`dist/`) | `turbo build`, CI |

`pnpm dev` picks up library source changes immediately, no lib rebuild needed.
