# Shipfox API Logs

Shipfox API Logs is the server-side store for step logs. It accepts an append-only
byte stream from the runner under an offset protocol, enforces a per-job storage
budget, keeps the hot bytes in PostgreSQL, and closes streams when a step ends or its
runner is lost. It owns its tables and its append route.

## Example

Register the module with the API module runner:

```ts
import {logsModule} from '@shipfox/api-logs';
import {createApp, listen} from '@shipfox/node-fastify';
import {initializeModules} from '@shipfox/node-module';

const {auth, routes} = await initializeModules({
  modules: [logsModule],
});

await createApp({auth, routes});
await listen();
```

This adds:

- log database migrations from `libs/api/logs/drizzle`
- the append route under `/runs/jobs/current/steps/:stepId/logs` (lease-authed)
- the `logs.stream.closed` publisher and the job-terminated subscriber that force-closes
  abandoned streams

## Streams

One stream per `(job, step, attempt)`, scoped by `job_id` (from the lease), so a lease can
only ever reach its own job's streams. There is no per-producer `kind` on the stream: every
record a step emits lives in this one stream, and a reader filters by the record's `type`
(see below) at read time without needing to know anything about the producer.

## The log record contract

One JSON object per line. The shared envelope is `{v, ts}`. The pipe rides on `stream` for
output; control records are flat by `type`:

```ts
{v: 1, ts, type: 'output',      stream: 'stdout' | 'stderr', data}     // <= 16 KiB data
{v: 1, ts, type: 'group_start', group_id, parent_group_id, name}      // name <= 1 KiB
{v: 1, ts, type: 'group_end',   group_id}
{v: 1, ts, type: 'end',         total_bytes}
{v: 1, ts, type: 'gap',         dropped_bytes}
{v: 1, ts, type: 'capped'}        // server-only
{v: 1, ts, type: 'runner_lost'}   // server-only
```

### Write-path protection

Two layers stop a runner from writing what it should not:

1. **Lease scope** — the lease binds writes to the job's own `(step, attempt)`, so cross-job
   injection is structurally impossible.
2. **Distinct ingest and read unions** — every line is validated against the **appendable**
   record union. The server-only `capped`/`runner_lost` tombstones are members of the read union
   only, not the appendable union, so a forged tombstone append is rejected (400). A forged
   tombstone that is otherwise a valid record is logged as a narrowed audit warning (no payload,
   no token).

### Multi-level named groups

`::group::<name>` / `::endgroup::` markers form a tree. The runner keeps a nesting stack: each
`group_start` gets a monotonic id (`g1`, `g2`, …) and a `parent_group_id` (the enclosing group,
or `null` at the root). Nesting is capped at depth 32; past the cap a group is flattened to plain
output and counted so its matching `::endgroup::` never pops a real parent. The tree is
recoverable from the ids, parent links, and the tombstone position at truncation.

## Agent-session capture (future)

Agent-session capture is a separate, not-yet-built feature. When it lands, an agent step's session
events ride this **same** stream as ordinary records, distinguished by their own record `type`(s);
a reader filters by `type` and re-joins those records to reconstruct the session. There is no
separate stream and no stream `kind` — one stream per `(job, step, attempt)`, read without knowing
any kind.

## Budget and terminal state

One shared, job-wide, generous accrual budget covers a job's logs. When the job's stored bytes
cross the budget, the job is capped and further appends are dropped. The append that crosses the
budget is stored in full, then an in-band `capped` tombstone record is injected once; later appends
are accepted-and-dropped. The cap is a **job-level** signal — a stream can be byte-complete and
still sit under a capped job if a sibling step exhausted the shared budget.

A stream closes either when the runner declares its end (an `end` record) or when the timeout sweep
force-closes a job's abandoned streams. A timeout close sets `truncated` and injects a `runner_lost`
tombstone. Each close writes one `logs.stream.closed` event, which drives compaction.

## Setup

This package is private to the workspace. Add it to another workspace package with:

```json
{
  "dependencies": {
    "@shipfox/api-logs": "workspace:*"
  }
}
```

Configuration lives in `src/config.ts` (object storage for compacted logs, the per-job budget,
the close grace period, and the append body limit). See each variable's `desc` for what to set.
