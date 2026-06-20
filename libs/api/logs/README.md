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

## Stream kinds

Every stream has a `kind`, part of its identity `(job, step, attempt, kind)`:

- **`log_stream`** — process output (stdout/stderr) framed as the log record contract below.
- **`agent_session`** — a verbatim, format-agnostic agent-session capture (a pi session, a
  Claude Agent SDK transcript, or a Codex SDK rollout). The server stores the bytes opaquely
  and never interprets them.

A step may carry both kinds at once; they are independent streams with independent offsets.
`kind` is **producer-declared**: the lease scopes a runner to its own job, not to a step type,
so the server does not check that an `agent_session` belongs to an agent step. Treat `kind` as
declared by the runner, not as authoritative step semantics; recognizing the session type (and
handling an unrecognizable one) is the reader's job.

## The `log_stream` record contract

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

Three layers stop a runner from writing what its kind does not allow:

1. **Lease scope** — the lease binds writes to the job's own `(step, attempt)`, so cross-job
   injection is structurally impossible.
2. **Kind-scoped validator** — the append route dispatches by `kind`: `log_stream` validates each
   line against the **appendable** record union; `agent_session` validates each line as JSON.
3. **Distinct ingest and read unions** — the server-only `capped`/`runner_lost` tombstones are
   members of the read union only, not the appendable union, so a forged tombstone append is
   rejected (400). A forged tombstone that is otherwise a valid record is logged as a narrowed
   audit warning (no payload, no token).

### Multi-level named groups

`::group::<name>` / `::endgroup::` markers form a tree. The runner keeps a nesting stack: each
`group_start` gets a monotonic id (`g1`, `g2`, …) and a `parent_group_id` (the enclosing group,
or `null` at the root). Nesting is capped at depth 32; past the cap a group is flattened to plain
output and counted so its matching `::endgroup::` never pops a real parent. The tree is
recoverable from the ids, parent links, and the tombstone position at truncation.

## Agent session capture

`agent_session` bytes are stored verbatim. Ingest checks only what the reader depends on: each
append body is **whole, newline-terminated lines**, decodes as **fatal UTF-8**, and each line is
**well-formed JSON** within `LOG_MAX_SESSION_LINE_BYTES`. "Valid JSON" means a well-formed JSON
value, not a recognizable message of any SDK.

Because every body is whole lines, `committed_length` always lands on a line boundary and no JSON
line spans two stored chunks. A live reader can poll chunks by `seq`, split each on `\n`, and parse
each piece as a complete event. The version and SDK identity live in the session header (the first
line); the server never stores them separately.

The append route is shared by both kinds (`kind` is a query param), so its body limit
(`LOG_APPEND_BODY_LIMIT_BYTES`) is one value for both. Keep the invariant
`LOG_APPEND_BODY_LIMIT_BYTES >= LOG_MAX_SESSION_LINE_BYTES >= the largest legitimate line`; the
store fails fast at startup if the body limit is below the line cap.

## Budget and terminal state

One shared, job-wide, generous accrual budget covers all log types of a job. When the job's stored
bytes cross the budget, the job is capped and further appends are dropped. The cap is signaled
differently per kind:

- `log_stream`: an in-band `capped` tombstone record.
- `agent_session`: the row's `capped` flag, set at close from the per-job budget. This is a
  **job-level** signal ("the job's shared budget was exhausted, so this stream may be incomplete"),
  not "this stream lost bytes" — a byte-complete session can read `capped` if a sibling stream
  exhausted the budget.

A stream closes either when the runner declares its end (`end` record, `log_stream` only) or when
the timeout sweep force-closes a job's abandoned streams. A timeout close sets `truncated`; for a
`log_stream` it also injects a `runner_lost` tombstone, while an `agent_session` records flags only
(no in-band tombstone, so the verbatim bytes stay intact). Each close writes one
`logs.stream.closed` event carrying the stream `kind`, which drives compaction.

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
the close grace period, the append body limit, and the agent-session line cap). See each
variable's `desc` for what to set.
