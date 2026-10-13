# Shipfox object storage

Shared Node infrastructure for scoped S3-compatible object storage.

## What it does

- **Shared S3 profile**: Loads common endpoint, region, credentials, and addressing mode, with an optional default bucket.
- **`S3ObjectStore`**: Restricts object operations to one non-empty key prefix.
- **Object operations**: Uploads and reads bytes, streams multipart uploads, signs reads, lists keys, and deletes objects.
- **Signed multipart uploads**: Creates, signs the parts of, completes, and aborts a multipart upload, so a client can upload parts straight to the store.
- **Client policies**: Uses enforced short timeouts for control operations and lets each consumer bound data-transfer requests when needed.

## Installation and setup

```sh
pnpm add @shipfox/node-object-storage
```

Set the shared `OBJECT_STORAGE_S3_*` connection variables for the deployment. Set `OBJECT_STORAGE_S3_BUCKET` when consumers share a default bucket, or leave it unset when every consumer selects its own bucket. Leave both credential variables unset to use the AWS SDK credential provider chain.

## Usage

```ts
import {
  createS3ObjectStore,
  objectStorageS3Profile,
  resolveObjectStorageS3Profile,
} from '@shipfox/node-object-storage';

const sessions = createS3ObjectStore({
  profile: resolveObjectStorageS3Profile(
    objectStorageS3Profile,
    {bucket: 'shipfox-sessions'},
    'SESSION_STORAGE_S3',
  ),
  prefix: 'agent-sessions',
  transferRequestTimeoutMs: 300_000,
});

await sessions.putBytes({
  key: 'agent-sessions/workspace/run/session/1',
  body: Buffer.from('encrypted transcript'),
  contentType: 'application/octet-stream',
});

sessions.close();
```

## Environment

The schema in `src/config.ts` owns the shared S3 variables and their defaults. Consumers resolve package-specific overrides with `resolveObjectStorageS3Profile`. Resolution fails when neither the consumer nor the shared profile selects a bucket.

## Behavior notes

Presigned URLs are signed without the SDK's default request checksum, because that checksum is computed for an empty body and fails the real part upload. Set `publicEndpoint` when clients reach the store by another name than the server does: the host is part of the signature. `completeMultipartUpload` uses the transfer client, so set `transferRequestTimeoutMs` when a store completes large uploads. `abortMultipartUpload` resolves when the upload no longer exists.

Every store requires a non-empty prefix. List and delete operations reject keys outside that prefix.

The package does not own object-key layouts, encryption, retention decisions, retries, telemetry, CORS, or bucket lifecycle policies.

## Development

```sh
turbo check --filter=@shipfox/node-object-storage
turbo type --filter=@shipfox/node-object-storage
turbo test --filter=@shipfox/node-object-storage
turbo build --filter=@shipfox/node-object-storage
```

## License

MIT
