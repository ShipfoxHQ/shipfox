# Development guide

This is the **public, MIT-licensed** half of Shipfox. The commercial product —
Cloud, Enterprise features, billing, the marketing site, hosted control
plane — lives in a separate, private repository: `ShipfoxHQ/shipfox-commercial`.

> External contributors: this file is informational. You don't need access to
> the commercial repo to build, run, or contribute to anything in `platform`.
> See [CONTRIBUTING.md](./CONTRIBUTING.md) for the day-to-day contributor flow.

---

## Dependency direction

```
   shipfox-commercial   ──depends on──▶   platform   (this repo)
        (private)                          (public)
```

**`platform` never depends on `shipfox-commercial`.** This is the load-bearing
invariant of the open-core split. Code, CI, infrastructure, tests, and tooling
in this repo must build with no awareness of the commercial side.

If you find yourself wanting to special-case "the cloud build" or "the
billing flow" here, you're crossing the boundary. Push the abstraction back into
the commercial repo or push a clean extension point into the public one.

---

## What lives here

```
apps/           Deployable services in the open core
  api/          Core HTTP API
  client/       Open-source web client
  runner/       Core runner

libs/           Reusable libraries
  api/          Backend feature modules (`@shipfox/api-*`)
  client/       Front-end feature packages (`@shipfox/client-*`)
  shared/       Shared building blocks (`@shipfox/node-*`, `@shipfox/react-ui`, …)

tools/          Build tooling re-exported as packages
                (`@shipfox/biome`, `@shipfox/swc`, `@shipfox/typescript`, …)

e2e/            End-to-end suites
```

Anything cloud-specific, billing-specific, WorkOS-specific, or marketing /
landing-site code does **not** belong here.

---

## Releases & publishing

Public packages are released with [Changesets](https://github.com/changesets/changesets).

```sh
pnpm changeset           # author a changeset describing your change
pnpm version-packages    # apply pending changesets locally (CI usually does this)
pnpm release             # build publishable packages + npm publish
```

`.github/workflows/release.yml` automates the "Version Packages" PR pattern:
merging a changeset to `main` triggers an auto-PR that, when merged, publishes
the bumped packages to `@shipfox/*` on npm.

The publish job is currently guarded by `if: false`. Flip it on after:

1. The `@shipfox` npm scope exists and a publish token is added as the
   `NPM_TOKEN` repository secret.
2. The packages you want to release have `"private": false` in their
   `package.json` (apps, e2e suites, and the workspace root stay private).

### What is publishable

Anything `"private": false` is a candidate. We expect the early publishable set
to include shared build tooling (`@shipfox/biome`, `@shipfox/typescript`,
`@shipfox/swc`, `@shipfox/ts-config`, `@shipfox/vite`, `@shipfox/vitest`),
`@shipfox/react-ui`, the DTO contract packages once stable, and the SDK
packages as they harden.

---

## How the commercial side consumes this repo

For context (you do not need to know this to contribute):

`shipfox-commercial` consumes `@shipfox/*` packages by cloning this repo at a
pinned Git SHA into a gitignored `.platform/` directory and globbing it into
its pnpm workspace. The SHA is recorded in `shipfox-commercial/platform.lock.json`.

As packages start publishing to npm, individual consumers there switch from
the workspace-bridge to normal semver ranges.

The implication for contributors here: **don't break `main`**. Anything landed
on `main` may immediately be picked up by the commercial repo by bumping a SHA.
Changeset entries are the contract for behavioural changes; treat them like
release notes.

---

## Local development

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [AGENTS.md](./AGENTS.md). TL;DR:

```sh
mise install
pnpm install
turbo build
turbo check type test
```
