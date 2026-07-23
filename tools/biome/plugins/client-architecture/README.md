# Client-architecture Biome plugins

This directory contains the five published Biome GritQL rules for client
source. Each rule emits a stable `client-architecture/<name>` diagnostic.

## Published rules

- `no-api-dto-in-core` rejects API DTO imports from `src/core/**`.
- `no-client-framework-in-core` rejects client framework imports from
  `src/core/**`.
- `no-response-dto-in-presentation` rejects response DTOs from pages and
  components.
- `no-raw-api-request` rejects raw API requests outside checked adapter paths.
- `no-query-cache-ownership` rejects query-cache writes in leaf components.

The package exports each `.grit` file at the matching path under
`plugins/client-architecture/`. These paths and diagnostic IDs are semver-
governed public API. Removing or renaming one requires a compatible package
release. The repository-local `fixture-boundary.grit` smoke rule is not part of
the published external contract.

## External repositories

Install `@shipfox/biome` at the repository root so the configuration path stays
stable across package managers and workspace layouts:

```sh
pnpm add -D @shipfox/biome
```

Reference the installed package files from the external repository's root
`biome.json`:

```json
{
  "plugins": [
    {
      "path": "./node_modules/@shipfox/biome/plugins/client-architecture/no-api-dto-in-core.grit",
      "includes": ["**/libs/client/**/src/core/**"]
    },
    {
      "path": "./node_modules/@shipfox/biome/plugins/client-architecture/no-client-framework-in-core.grit",
      "includes": ["**/libs/client/**/src/core/**"]
    },
    {
      "path": "./node_modules/@shipfox/biome/plugins/client-architecture/no-response-dto-in-presentation.grit",
      "includes": [
        "**/libs/client/**/src/pages/**",
        "**/libs/client/**/src/components/**"
      ]
    },
    {
      "path": "./node_modules/@shipfox/biome/plugins/client-architecture/no-raw-api-request.grit",
      "includes": [
        "**/libs/client/**",
        "**/libs/shared/react/ui/**",
        "!**/libs/client/api/**",
        "!**/libs/client/**/src/hooks/api/**"
      ]
    },
    {
      "path": "./node_modules/@shipfox/biome/plugins/client-architecture/no-query-cache-ownership.grit",
      "includes": [
        "**/libs/client/**/src/components/**",
        "**/libs/shared/react/ui/**/src/components/**"
      ]
    }
  ]
}
```

Add the repository's standard exclusions for tests, stories, generated files,
build output, and `node_modules` to each production include list. The globs
above work from a different repository root and do not require copied `.grit`
files. Keep cross-file ownership checks and runtime policy in
`@shipfox/client-architecture-policy` or focused tests.

## Local fixture harness

Run the focused harness with:

```sh
pnpm --filter=@shipfox/biome test
```

The harness uses the same `shipfox-biome-check` wrapper as package checks. It
checks rule IDs, replacement guidance, source locations, and pass/fail results
for local and packed external fixtures.
