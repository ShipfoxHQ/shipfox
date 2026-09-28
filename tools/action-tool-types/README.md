# @shipfox/action-tool-types

The generator for the tool argument types that `@shipfox/actions` ships, built from the provider
tool catalogs.

## What it does

- **`generate`** reads every provider tool catalog and writes
  `libs/shared/workflow/actions/src/generated/tool-catalog.ts`. It emits one argument type per
  tool id and per `family.method` name from the tool's `inputSchema`, using
  `json-schema-to-typescript`. A `family.method` type omits `method`, which the runner fills in.
  Results are not typed.
- **The drift test** fails when the committed file differs from a fresh render, so a catalog
  change cannot ship without its types.

## Installation and setup

This is a private workspace package. It needs no setup beyond `pnpm install`.

## Usage

Regenerate the file after changing a provider catalog, then commit it:

```sh
pnpm --filter @shipfox/action-tool-types generate
```

## Behavior notes

- **A new provider must be added to `src/catalogs.ts`.** The generator reads only the catalogs
  listed there.
- **Schema titles are dropped,** so nested objects stay inline and cannot collide across tools.
- **Schemas without `additionalProperties: false` keep an index signature,** so the type accepts
  the extra keys the provider accepts.

## Development

```sh
turbo check --filter=@shipfox/action-tool-types
turbo type --filter=@shipfox/action-tool-types
turbo test --filter=@shipfox/action-tool-types
```

## License

MIT
