# @shipfox/engineering-guidance

This package gives Shipfox tools one fixed copy of the engineering docs. It is
for build tools and checks that need to read those docs.

## Quick start

Install it as a development dependency:

```sh
pnpm add -D @shipfox/engineering-guidance
```

Then read the bundle:

```ts
import {
  getGuidanceBundleRoot,
  readGuidanceManifest,
} from '@shipfox/engineering-guidance';

const root = getGuidanceBundleRoot();
const manifest = readGuidanceManifest();

console.log(root);
console.log(manifest.source.commit);
```

`root` is the read-only bundle directory. The main entrypoint is
`repository/docs/README.md`.

## What is in the bundle

The bundle starts with the upstream docs map. It includes approved root files
and Markdown files that those roots reach. Each link to tracked source uses the
source commit in a GitHub link. Each file has a SHA-256 hash in the manifest.

Product docs and Cloud content are not copied. Change the source docs in the
upstream repository. Do not edit a copied bundle.

See the [manifest schema](schema/manifest.schema.json) for the metadata shape.

## Limits

This package is for development tools. It has no application runtime role. It
does not run a post-install sync and does not write to the consumer repository.
The consumer chooses when and where to copy the bundle.

The published package contains the built bundle, its manifest, and a small
locator API. It does not export TypeScript source.

## Development

Run the focused package checks:

```sh
turbo build --filter=@shipfox/engineering-guidance
turbo type --filter=@shipfox/engineering-guidance
turbo test --filter=@shipfox/engineering-guidance
turbo verify --filter=@shipfox/engineering-guidance
```

`build` creates the bundle. `verify` checks file hashes and links.

Read the [engineering documentation map](../../docs/README.md) and [ADR 0005](../../docs/adr/0005-repository-documentation-architecture.md)
before changing the source or ownership rules.

## License

MIT
