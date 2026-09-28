# Shipfox API Registry DTO

Registry DTOs define the inter-module contract that lets other API modules resolve verified registry versions.

## What it does

- **`registryInterModuleContract`**: Declares `resolveVersion`, `getSource`, and `getReadme` on the `registry` module, with their known errors.
- **Version schemas**: `resolveRegistryVersionRequestSchema`, `registryVersionRefSchema`, `resolvedRegistryVersionSchema`, `registrySourceSchema`, and `registryReadmeSchema` describe each input and output.
- **Known errors**: Every method can fail with `registry-disabled`, `registry-version-not-found`, `registry-unavailable`, `registry-signature-invalid`, or `registry-schema-unsupported`. Only `registry-unavailable` is worth retrying.

## Installation and setup

```sh
pnpm add @shipfox/api-registry-dto
```

## Usage

Import the contract from `@shipfox/api-registry-dto/inter-module` when composing a Registry client or presentation.

```ts
import {registryInterModuleContract} from '@shipfox/api-registry-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';

const transport = createInMemoryInterModuleTransport();
const registry = transport.createClient(registryInterModuleContract);
// Register the Registry presentation, then call transport.seal().

try {
  const {document, content} = await registry.resolveVersion({
    package: 'shipfox/slack-thread-digest',
    version: '1.4.2',
    kind: 'action',
  });
  console.log(document.version, Buffer.from(content, 'base64').length);
} catch (error) {
  if (isInterModuleKnownError(registryInterModuleContract.methods.resolveVersion, error)) {
    console.log(error.code);
  }
}
```

## Behavior notes

- Inter-module calls carry JSON only, so bundles travel as base64 strings. `content` is the gzip content bundle and `source` is the gzip source archive. Both were checked against the digests in the signed document.
- `document` is the signed version document, verified against the instance's trusted keys.
- `getSource` and `getReadme` need no `kind`, because a package has one kind. `getReadme` returns `null` for a version without a README.

## Development

```sh
turbo check --filter=@shipfox/api-registry-dto
turbo type --filter=@shipfox/api-registry-dto
turbo test --filter=@shipfox/api-registry-dto
```

## License

MIT
