# Shipfox API Logs

Shipfox API Logs is the server-side store for step logs. It accepts an append-only
byte stream from the runner under an offset protocol, enforces a per-job storage
budget, keeps the hot bytes in PostgreSQL, and closes streams when a step ends or its
runner is lost. It serves those logs back on a session-authed read endpoint, and owns its
tables and routes.

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
- the read route under `/steps/:stepId/attempts/:attempt/logs` (session-authed): inline NDJSON
  while the stream is hot, a presigned object URL once it is compacted
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
{v: 1, ts, type: 'output',        stream: 'stdout' | 'stderr', data}   // <= 16 KiB data
{v: 1, ts, type: 'group_start',   group_id, parent_group_id, name}     // name <= 1 KiB
{v: 1, ts, type: 'group_end',     group_id}
{v: 1, ts, type: 'end',           total_bytes}
{v: 1, ts, type: 'gap',           dropped_bytes}
{v: 1, ts, type: 'agent_session', data}                               // one verbatim entry, <= LOG_MAX_SESSION_LINE_BYTES
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

## Read path

A session-authed `GET /steps/:stepId/attempts/:attempt/logs?cursor=N` serves one endpoint for both
the live tail and the full history. It is workspace-scoped through the stream row's denormalized
`workspace_id`; a 404 covers both a missing stream and a cross-workspace step, so existence never
leaks.

- **Hot (open, or closed but not yet compacted)** — inline NDJSON read from the Postgres chunks,
  walked by chunk `seq` so server control tombstones interleave with runner bytes exactly as
  compaction concatenates them, making the inline bytes byte-identical to the decompressed object.
  Pages are bounded by `LOG_READ_INLINE_MAX_BYTES`; the client follows `has_more`/`next_cursor` to
  drain the backlog, then tails from the last cursor.
- **Cold (compacted, `object_key` set)** — a presigned GET URL (`LOG_READ_URL_TTL_SECONDS`) so the
  browser fetches the object directly and API egress is bypassed.

## Agent-session capture

An agent step forwards each agent session entry as one `agent_session` record on this **same**
stream, distinguished by its `type`; a reader filters by `type` and `JSON.parse`s each record's
`data` (one verbatim session entry line) to reconstruct the session. There is no separate stream
and no stream `kind` — one stream per `(job, step, attempt)`, read without knowing any kind.

The runner forwards entries opaquely and never splits one across records, so a record always
carries a whole entry. Per-entry size is bounded by `LOG_MAX_SESSION_LINE_BYTES` (a larger line is
rejected with 400, and the runner drops it with a `gap`); the request body limit
(`LOG_APPEND_BODY_LIMIT_BYTES`) must hold a full line plus framing, enforced by a startup invariant.

## Budget and terminal state

One shared, job-wide, generous accrual budget covers a job's logs. When the job's stored bytes
cross the budget, the job is capped and further appends are dropped. The append that crosses the
budget is stored in full, then an in-band `capped` tombstone record is injected once; later appends
are accepted-and-dropped. The cap is a **job-level** signal — a stream can be byte-complete and
still sit under a capped job if a sibling step exhausted the shared budget.

A stream closes on one of three triggers: the runner declares its end (an `end` record); the
job-terminated sweep force-closes a job's abandoned streams when the job goes terminal; or the
reaper cron force-closes any stream still open past the lease window (`LOG_STREAM_REAP_AFTER_SECONDS`),
the backstop for a stream the one-shot sweep missed (one whose first append landed after the sweep
ran). Both force-close paths are timeout closes: they set `truncated` and inject a `runner_lost`
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
the close grace period, the append body limit, and the read path's presigned-URL TTL and inline
page cap). See each variable's `desc` for what to set.
