# Changesets

This folder is the inbox for [Changesets](https://github.com/changesets/changesets).
Run `pnpm changeset` whenever a PR changes a publishable package's public behaviour;
it walks you through writing a Markdown file that lands here.

## What gets published

Changesets only releases packages with `"private": false` in `package.json`. The
current publishable set (canonical names listed; check each `package.json` to be
sure):

- `@shipfox/react-ui`
- `@shipfox/biome`, `@shipfox/swc`, `@shipfox/typescript`, `@shipfox/ts-config`,
  `@shipfox/vite`, `@shipfox/vitest` (build tooling re-used by downstream
  consumers, including `shipfox-commercial`)
- the public DTO/SDK packages once their public surface is stable

Apps under `apps/*`, end-to-end suites under `e2e/*`, and the workspace root are
all `"private": true` and skipped automatically.

## Workflow

```sh
# Add a changeset describing the change (selects packages + bump type)
pnpm changeset

# Apply pending changesets to bump versions + update CHANGELOGs
pnpm version-packages

# Build the publishable packages and publish to npm under @shipfox/*
pnpm release
```

`pnpm release` requires `NPM_TOKEN` (npm publish access for the `@shipfox` scope)
and should typically run from CI on the `main` branch after a "version PR"
merges. See `DEVELOPMENT.md` at the repo root for the cross-repo release flow.

## Note for `shipfox-commercial`

`shipfox-commercial` consumes platform packages via a Git-SHA bridge (see
`DEVELOPMENT.md`). When this folder publishes a package to npm, the
corresponding consumer in `shipfox-commercial` should switch from the
`workspace:*` indirection to a normal semver range.
