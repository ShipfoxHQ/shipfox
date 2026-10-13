# Shipfox API Cache

`@shipfox/api-cache` stores job caches for the API: the runner-facing routes that save and restore an archive, the tables behind them, and the sweeper that removes entries.

## What it does

- **`createCacheModule`**: Declares the `cache` module: its database, the lease-authed routes under `/runs/jobs/current/cache`, the member routes that manage the cache, the cron jobs, and the `cache` inter-module contract.
- **Reserve and commit**: A save reserves a key, uploads the archive straight to object storage through signed part URLs, and commits. The API never carries archive bytes.
- **Restore**: A restore walks the scopes in order. Per scope it tries the exact key, then each restore key by newest entry, and answers a signed download URL that accepts `Range` headers.
- **Dev-run sandbox**: A dev run saves into a sandbox of the user who started it and reads that sandbox before the shared scope. Synced runs and other users never see it.
- **Storage checks**: The module checks the stored object at commit, before it signs a download, and when a save asks whether a key exists. A missing object removes its row and the lookup moves on.
- **Sweeper**: Every 10 minutes a Temporal cron expires idle entries, removes stale uploads, and evicts the least recently used entries of a workspace over its storage limit.
- **`CacheStoragePolicy`**: Lets the composing application set the storage limit of each workspace.
- **Storage samples**: An hourly job records the stored bytes of each project as a Usage storage sample.
- **Management**: Members list the scopes and entries of a project, delete an entry or a scope, and read the stored bytes of a workspace. Workspace admins set the retention.
- **`checkBucketReachable`**: Reports whether the cache bucket answers.

## Installation and setup

The API composition root registers the module in `libs/api/server/src/modules.ts`. It needs the object store configured through `OBJECT_STORAGE_S3_*`.

The bucket needs an `AbortIncompleteMultipartUpload` lifecycle rule of one day. `dev/garage/bootstrap.sh` sets it for the local buckets. Browsers never touch cache objects, so no CORS rule is needed.

```sh
pnpm add @shipfox/api-cache
```

## Usage

The module takes the Workflows inter-module client, which it uses to read a run's origin and the user who started it, the Usage client, which receives the storage samples, and the Projects client, which tells the workspace of a project.

```ts
import {createCacheModule} from '@shipfox/api-cache';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {UsageModuleClient} from '@shipfox/api-usage-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {initializeModules} from '@shipfox/node-module';

declare const workflows: WorkflowsModuleClient;
declare const usage: UsageModuleClient;
declare const projects: ProjectsModuleClient;

await initializeModules({modules: [createCacheModule({workflows, usage, projects})]});
```

Pass a storage policy to set the limit of each workspace. Without one, `CACHE_WORKSPACE_MAX_BYTES` applies to every workspace.

```ts
import {type CacheStoragePolicy, createCacheModule} from '@shipfox/api-cache';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {UsageModuleClient} from '@shipfox/api-usage-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';

declare const workflows: WorkflowsModuleClient;
declare const usage: UsageModuleClient;
declare const projects: ProjectsModuleClient;

const policy: CacheStoragePolicy = {
  resolve: async ({workspaceId}) => ({
    maxStoredBytes: workspaceId === 'trial' ? 10 * 1024 ** 3 : null,
  }),
};

const cacheModule = createCacheModule({workflows, usage, projects, storage: {policy}});
console.log(cacheModule.name);
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
| `CACHE_WORKSPACE_MAX_BYTES` | Storage limit of every workspace when no storage policy is composed. Unset means no limit. |

## Routes

### Runner routes

These routes use the job lease. Workspace and project come from the lease claims, never from the body.

| Route | Purpose |
| --- | --- |
| `POST /runs/jobs/current/cache/restore` | Find the entry to restore and sign its download URL. |
| `POST /runs/jobs/current/cache/entries` | Reserve a key. Answers `reserved` with one signed URL per part, or `exists`, `in_progress`, or `too_large`. |
| `POST /runs/jobs/current/cache/entries/:entryId/commit` | Complete the upload and mark the entry ready. |
| `DELETE /runs/jobs/current/cache/entries/:entryId` | Abort an upload of this job execution and free its key. |
| `POST /runs/jobs/current/cache/entries/check` | Tell whether a key is saved in the scope a save would write. |

### Management routes

These routes use a user session. A project route answers `404 project-not-found` to a user who is not a member of the project's workspace, the same as for a project that does not exist. A workspace route answers `403` to a non-member.

| Route | Who | Purpose |
| --- | --- | --- |
| `GET /projects/:projectId/cache/scopes` | Member | Scopes with entry count, bytes, and last use. A dev sandbox carries `dev_sandbox` with its user. |
| `GET /projects/:projectId/cache/entries` | Member | Committed entries, newest first, filtered by `scope` and `key_prefix`, paged with `cursor` and `limit`. |
| `DELETE /projects/:projectId/cache/entries/:entryId` | Member | Delete one committed entry and its archive. |
| `DELETE /projects/:projectId/cache/scopes/:scope` | Member | Delete every committed entry of a stored scope. The scope is the rest of the path, encoded or not. A dev sandbox scope reads `dev/{user_id}/{scope}`. |
| `GET /workspaces/:workspaceId/cache/usage` | Member | Stored bytes, limit, bytes per project, and the latest 100 deletions. It reads the current entries, not usage records. |
| `GET /workspaces/:workspaceId/cache/settings` | Member | Retention in days, with the default and the maximum. |
| `PUT /workspaces/:workspaceId/cache/settings` | Workspace admin | Set the retention, from 1 day to `CACHE_MAX_RETENTION_DAYS`. |

The schemas live in `@shipfox/api-cache-dto`.

### Inter-module contract

`@shipfox/api-cache-dto/inter-module` exposes `listCacheEntries`, `getCacheUsage`, and `deleteCacheEntries` for callers that act for a workspace, such as the Shipfox MCP server. A project of another workspace answers the known error `project-not-found`.

## Data model

This module owns tables with the `cache_` prefix.

| Table | Purpose |
| --- | --- |
| `cache_entries` | One immutable archive per `(project_id, scope, key, version)`. The row is the index. The object sits under the generated key `{prefix}/{workspace_id}/{project_id}/{entry_id}`, so user strings never reach an object key. |
| `cache_workspace_settings` | Retention days per workspace. A workspace without a row uses the default. |
| `cache_deletions` | Why an entry disappeared: `expired`, `evicted`, `manual`, or `missing`. Rows are pruned after 30 days. |

## Behavior notes

- **Reserve:** The unique index on the entry identity decides concurrent reserves. The loser skips its upload. The job execution that holds an `uploading` row gets its reservation back with fresh URLs. When it reserves again with another size or hash, the old upload is aborted and a new reservation starts.
- **Commit:** Commit completes the multipart upload, then reads the object size. A size that differs from the reservation, or an entry over `CACHE_MAX_ENTRY_BYTES`, deletes the object and the row (`size-mismatch`, `entry-too-large`). An abort that wins the race against a commit answers `upload-aborted` and removes the object. A repeated commit answers `ready`.
- **Ownership:** Only the job execution that reserved an upload can commit or abort it. Any other caller gets `entry-not-found` on commit and a no-op on abort.
- **Dev runs:** A dev run started by user `U` writes scope `X` to `dev/U/X` and reads `dev/U/X` before `X`. A run without a user uses `dev/shared/X`. A body that names a `dev/` scope fails with `reserved-scope`.
- **Missing objects:** When `head` finds no object, or one of another size, the row is deleted with reason `missing` and the lookup continues. When `head` fails, the module trusts the row and a dead URL becomes a miss in the SDK.
- **Last use:** A restore or a repeated save refreshes `last_accessed_at` only when the stored value is over an hour old.
- **Sweep:** The `cache-sweep` cron runs every 10 minutes on the `cache-maintenance` task queue. One pass expires `ready` entries idle past the workspace's retention, removes stale `uploading` entries, evicts workspaces over their limit, and prunes old deletion records. A pass stops after 8 minutes and the next one continues.
- **Stale uploads:** An upload is stale after two hours, or after `CACHE_URL_TTL_SECONDS` plus one hour when that is longer, so an upload with a valid signed URL is never removed.
- **Deletion order:** The object goes first, then the row. A storage failure leaves the row for the next pass. A stale upload has its multipart upload ended and its object deleted before its row goes. It leaves no `cache_deletions` row, because it was never a visible entry.
- **Storage limit:** Stored bytes are the sum of `ready` entries of a workspace. Over the limit, the least recently used entries are evicted until the workspace fits. Eviction runs in the sweep and at commit, where it never removes the newly committed entry. A reserve for an entry larger than the limit answers `too_large`.
- **Storage policy:** A resolved limit is cached for 60 seconds. A policy that throws applies no limit for that call: the sweep skips eviction for the workspace and a save proceeds.
- **Storage samples:** A Temporal cron runs at minute 5 of every hour. It sums the `ready` entries per project and calls `recordStorageSamples` in Usage with the key `cache:{projectId}:{windowStart}`, the stored bytes, and the object count. A repeated run for the same hour is counted as a duplicate by Usage. A project with no entries produces no sample, and a missed hour is not backfilled.
- **Manual deletion:** A deletion removes the object first, then the row, and writes a `manual` record. A storage failure stops a scope deletion and leaves the remaining entries listed, so a retry finishes it. An upload in flight is not an entry, so a deletion leaves it to its job or to the sweeper.
- **Metrics:** `cache_restores` counts lookups by result (`exact`, `prefix`, `miss`). `cache_saves` counts reserve outcomes, commits, aborts, and failed commits. `cache_deletions` counts deleted entries by reason, with `stale_upload` for a reaped upload. `cache_sweep_duration` records the length of a sweep pass. `cache_stored_bytes` is a service gauge of the bytes of all `ready` entries.

## Development

```sh
turbo check --filter=@shipfox/api-cache
turbo type --filter=@shipfox/api-cache
turbo test --filter=@shipfox/api-cache
```

Tests need the repository's local Postgres and Garage. They upload and download through real signed URLs. The build also bundles the Temporal workflow that the worker loads from `dist/`.

## License

MIT
