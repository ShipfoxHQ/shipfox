# Shipfox API Cache

`@shipfox/api-cache` stores job caches for the API: the runner-facing routes that save and restore an archive, and the tables behind them.

## What it does

- **`createCacheModule`**: Declares the `cache` module: its database and the lease-authed routes under `/runs/jobs/current/cache`.
- **Reserve and commit**: A save reserves a key, uploads the archive straight to object storage through signed part URLs, and commits. The API never carries archive bytes.
- **Restore**: A restore walks the scopes in order. Per scope it tries the exact key, then each restore key by newest entry, and answers a signed download URL that accepts `Range` headers.
- **Dev-run sandbox**: A dev run saves into a sandbox of the user who started it and reads that sandbox before the shared scope. Synced runs and other users never see it.
- **Storage checks**: The module checks the stored object at commit, before it signs a download, and when a save asks whether a key exists. A missing object removes its row and the lookup moves on.
- **`checkBucketReachable`**: Reports whether the cache bucket answers.

## Installation and setup

The API composition root registers the module in `libs/api/server/src/modules.ts`. It needs the object store configured through `OBJECT_STORAGE_S3_*`.

The bucket needs an `AbortIncompleteMultipartUpload` lifecycle rule of one day. `dev/garage/bootstrap.sh` sets it for the local buckets. Browsers never touch cache objects, so no CORS rule is needed.

```sh
pnpm add @shipfox/api-cache
```

## Usage

The module takes the Workflows inter-module client, which it uses to read a run's origin and the user who started it.

```ts
import {createCacheModule} from '@shipfox/api-cache';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {initializeModules} from '@shipfox/node-module';

declare const workflows: WorkflowsModuleClient;

await initializeModules({modules: [createCacheModule({workflows})]});
```

## Environment

`src/config.ts` owns the variables, their defaults, and their validation. Each `CACHE_STORAGE_S3_*` variable overrides the matching shared `OBJECT_STORAGE_S3_*` variable for cache archives.

| Variable | Purpose |
| --- | --- |
| `CACHE_STORAGE_S3_*` | Endpoint, region, bucket, prefix, credentials, and addressing mode for the cache bucket. The prefix defaults to `cache`. |
| `CACHE_STORAGE_PUBLIC_ENDPOINT` | Host written into signed URLs when runners reach the object store by another name than the API does. |
| `CACHE_MAX_ENTRY_BYTES` | Largest compressed entry a job may save. |
| `CACHE_URL_TTL_SECONDS` | Lifetime of signed upload and download URLs. |
| `CACHE_DEFAULT_RETENTION_DAYS` and `CACHE_MAX_RETENTION_DAYS` | Retention applied to a workspace without a setting, and the longest a workspace may set. |

## Routes

All routes use the job lease. Workspace and project come from the lease claims, never from the body.

| Route | Purpose |
| --- | --- |
| `POST /runs/jobs/current/cache/restore` | Find the entry to restore and sign its download URL. |
| `POST /runs/jobs/current/cache/entries` | Reserve a key. Answers `reserved` with one signed URL per part, or `exists`, `in_progress`, or `too_large`. |
| `POST /runs/jobs/current/cache/entries/:entryId/commit` | Complete the upload and mark the entry ready. |
| `DELETE /runs/jobs/current/cache/entries/:entryId` | Abort an upload of this job execution and free its key. |
| `POST /runs/jobs/current/cache/entries/check` | Tell whether a key is saved in the scope a save would write. |

The schemas live in `@shipfox/api-cache-dto`.

## Data model

This module owns tables with the `cache_` prefix.

| Table | Purpose |
| --- | --- |
| `cache_entries` | One immutable archive per `(project_id, scope, key, version)`. The row is the index. The object sits under the generated key `{prefix}/{workspace_id}/{project_id}/{entry_id}`, so user strings never reach an object key. |
| `cache_workspace_settings` | Retention days per workspace. A workspace without a row uses the default. |
| `cache_deletions` | Why an entry disappeared: `expired`, `evicted`, `manual`, or `missing`. |

## Behavior notes

- **Reserve:** The unique index on the entry identity decides concurrent reserves. The loser skips its upload. The job execution that holds an `uploading` row gets its reservation back with fresh URLs.
- **Commit:** Commit completes the multipart upload, then reads the object size. A size that differs from the reservation deletes the object and the row. A repeated commit answers `ready`.
- **Ownership:** Only the job execution that reserved an upload can commit or abort it. Any other caller gets `entry-not-found` on commit and a no-op on abort.
- **Dev runs:** A dev run started by user `U` writes scope `X` to `dev/U/X` and reads `dev/U/X` before `X`. A run without a user uses `dev/shared/X`. A body that names a `dev/` scope fails with `reserved-scope`.
- **Missing objects:** When `head` finds no object, or one of another size, the row is deleted with reason `missing` and the lookup continues. When `head` fails, the module trusts the row and a dead URL becomes a miss in the SDK.
- **Last use:** A restore or a repeated save refreshes `last_accessed_at` only when the stored value is over an hour old.
- **Metrics:** `cache_restores` counts lookups by result (`exact`, `prefix`, `miss`). `cache_saves` counts reserve outcomes, commits, aborts, and failed commits.

## Development

```sh
turbo check --filter=@shipfox/api-cache
turbo type --filter=@shipfox/api-cache
turbo test --filter=@shipfox/api-cache
```

Tests need the repository's local Postgres and Garage. They upload and download through real signed URLs.

## License

MIT
