# ADR 0023: Cache context

- **Status:** Accepted.
- **Date:** 2026-10-13.
- **Decision owners:** Server architecture and job execution.
- **Linear issue:** [ENG-3071](https://linear.app/shipfox/issue/ENG-3071/cache-module-and-runner-facing-routes).
- **Amends:** [ADR 0015: Usage context and application seams](0015-usage-context-and-application-seams.md).
- **Related:** [ADR 0002: Server inter-module architecture](0002-api-inter-module-architecture.md),
  [ADR 0006: Database ownership boundaries](0006-database-ownership-boundaries.md).

## Context

**Every job starts on a clean runner.** Dependency installs, toolchain downloads, and build
outputs repeat on every run. Users coming from other CI systems expect a cache, and Shipfox has
no place that stores files between jobs.

**No existing context fits.** Workflows owns run orchestration and Logs owns step output with a
per-job budget. A cache entry outlives the job that saved it, is shared by later jobs of a
project, and is retained by last use. It needs its own tables, retention, and limits.

**Stored bytes are a new quantity to measure.** ADR 0015 defines two usage records, both
event-shaped: a job execution and an inference segment. Storage is a level over time, not an
event. It needs a periodic sample and a way for a composing application to describe an allowance
without the shell knowing a rate.

## Decision

### Cache is a bounded context

**Cache owns saved archives and the rules around them.** It joins the context map in the
[backend architecture guide](../architecture/backend-architecture.md#bounded-contexts):

| Bounded context | Packages |
| --- | --- |
| Cache | `@shipfox/api-cache`, `@shipfox/api-cache-dto`, and later `@shipfox/client-cache`. |

The database namespace is `cache` and tables use the `cache_` prefix under ADR 0006. The module
has no outbox. It calls three peers through their inter-module contracts: Workflows, for a run's
origin and the user who started it, Usage, for storage samples, and Projects, for the workspace a
project belongs to.

**The database is the index.** Lookup, retention, eviction, and usage read `cache_entries`.
Object storage holds opaque archives under generated keys, so no user string reaches an object
key.

**Archive bytes never pass through the API.** A runner reserves a key, receives signed part URLs,
uploads straight to object storage, and commits. A restore receives a signed download URL. The
API signs and checks, and it never carries the archive.

**The job lease is the trust boundary.** The runner-facing routes use the leased-job
authentication method. Workspace and project come from the lease claims, never from a body. Only
the job execution that reserved an upload can commit or abort it.

**Dev runs write to a sandbox.** A dev run started by user `U` writes scope `X` to
`dev/U/X` and reads `dev/U/X` before `X`. A run without a user uses `dev/shared/X`. The `dev/`
prefix is reserved, and a body that names it is rejected. A dev run cannot change what a synced
run, or another user's dev run, restores.

**The module checks the object before it trusts the row.** Before it signs a download, and when
a save asks whether a key exists, it calls `head` on the ready entry. A missing object, or one of
another size, deletes the row with reason `missing` and the lookup continues. A failing `head`
call trusts the row, because a dead URL is a miss on the runner. At commit, `head` checks the
upload instead: a missing object or a size that differs from the reservation deletes the
uploading row and fails the save without a deletion record, and a failing `head` call leaves the
row uploading for a retry or an abort.

**Members manage the cache through user routes and an inter-module contract.** Routes under
`/projects/:projectId/cache` and `/workspaces/:workspaceId/cache` list and delete entries, read
cache usage, and set the retention. Any member of the workspace deletes entries, and a
workspace admin changes the retention. A project route resolves the workspace through Projects and
answers a non-member with the same 404 as a missing project. The usage route reads the current
`cache_entries`, not usage records. The Cache contract exposes the same three operations to the
Shipfox MCP server, which acts for the workspace of its credential. A manual deletion removes the
object, then the row, and writes a `manual` deletion record.

### The object store gains signed multipart uploads

`@shipfox/node-object-storage` adds `createMultipartUpload`, `presignUploadPart`,
`completeMultipartUpload`, and `abortMultipartUpload` to `S3ObjectStore`. A store can also sign
URLs for a public endpoint, because the host is part of a signature and runners can reach the
store by another name than the API does. Presigned requests are signed without the SDK's default
request checksum, which fails every real part upload.

### Storage is a third usage record kind

**Usage gains a storage sample.** A sample is the stored bytes of one source and project at the
start of a clock hour, counted for the whole hour. The next delivery adds the table, the
`recordStorageSamples` command, the `usage.storage_sample.recorded` event, and the
`listStorageSamples` cursor, which mirror the inference segment. Usage keeps holding quantities,
never amounts.

### The pricing seam can describe an allowance

**`UsagePricing` gains one optional operation, `describeStorage`.** It receives the workspace
and its stored bytes and returns the included bytes, the bytes above the allowance, an
application-formatted rate, and an optional estimate, or `null`. Without it, the cache screens
show quantities only. The rules of the existing seam apply: optional at composition, isolated
failures, and no default implementation.

### A storage policy bounds a workspace

**`createCacheModule` accepts an optional `CacheStoragePolicy`.** It has one method that
resolves the maximum stored bytes of a workspace, or no limit. It is shaped like the execution
limits policy. Without a policy the module uses `CACHE_WORKSPACE_MAX_BYTES`. A policy that throws
means no change. The limit is not stored upstream and has no user-facing setting.

## Consequences

- Upstream gains one context with three packages and five runner-facing routes. A consumer needs
  only the DTO package.
- The Workflows contract gains `getWorkflowRunOrigin`. Adding a required method breaks every
  implementer and fake of the contract, which are all internal.
- Operators provide an `AbortIncompleteMultipartUpload` rule of one day on the cache bucket
  before launch.
- Retention is enforced by the module's own worker, so every S3-compatible store behaves the
  same. The sweeper, the storage policy, and the sampler ship in the deliveries that follow this
  record, and the cache is not launched before the sweeper.
- A workspace can sit above its limit for up to the length of one upload, because the limit is
  checked at reserve and at commit.
- Saves and restores need free runner disk equal to the archive size. That is a limit of the
  SDK delivery, not of this context.

## Rejected alternatives

### Stream archives through the API

**The API would carry gigabytes per job.** Signed URLs move that traffic to the store and keep
API memory and egress flat.

### Use bucket lifecycle rules for retention

**Retention follows last use, and lifecycle rules follow creation.** A rule cannot refresh an
entry when a job restores it, and not every S3-compatible store supports the same rules. The
module's worker also writes the deletion history.

### Index entries by listing the bucket

**Lookup needs the newest entry for a key prefix, per scope, in order.** The database answers it
with one indexed query. Listing a bucket cannot, and it makes eviction and usage depend on a slow
scan.

### Store cache entries in Logs or Workflows

**Neither context owns a file that outlives a job.** Their retention, limits, and ownership rules
differ, and a cache would couple them to a feature that has its own lifecycle.

### Record storage as an event

**Stored bytes are a level.** An event per save or delete says nothing about the hours between
them, and a consumer would rebuild the level from a stream that can lose or reorder facts. An
hourly sample is the quantity a composing application rates.
