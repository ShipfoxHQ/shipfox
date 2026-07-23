# API architecture Biome plugins

These Biome GritQL rules check local import and export shapes in API DTO
packages. The root [`biome.json`](../../../../biome.json) loads them for
matching files under `libs/api/**/*-dto/`.

Each diagnostic points at the import or export that crosses the approved
boundary. Do not fix an API architecture error with `biome-ignore`.

## Rules

- `no-dto-root-inter-module` keeps synchronous contracts at the producer DTO
  `/inter-module` subpath instead of the DTO root.
- `no-dto-root-implementation-detail` keeps `core`, `db`, `presentation`,
  `provider`, and test support paths out of DTO roots.
- `no-dto-inter-module-import` prevents a DTO package from consuming another
  DTO package's synchronous client surface.

The rules cover static imports, re-exports, dynamic imports, type-only imports,
and side-effect imports. API consumer tests follow the same package boundary as
production source. The production globs include `.test.ts`, `test/**`, and
`tests/**`. They exclude only `dist`, `node_modules`, and `coverage` output.

## Enforcement ownership

Biome owns checks that need only one source expression.
`@shipfox/api-architecture-policy` owns package classification, registry,
manifest, and export-map checks. It also owns import rules that need context or
same-context SPI ownership from `api-contexts.cjs`. Dependency Cruiser checks
resolved dependency boundaries.

## Fixture harness

Run the focused harness with:

```sh
pnpm --filter=@shipfox/biome test
```

The fixtures mirror DTO package paths under `libs/api/`. Each rule has allowed
and rejected trees. The rejected inter-module fixtures include source tests and
setup files so the harness protects their production coverage.
