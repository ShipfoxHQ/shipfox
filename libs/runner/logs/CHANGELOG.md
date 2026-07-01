# @shipfox/runner-logs

## 0.1.0

### Minor Changes

- 6c80f00: Add the runner-side log capture pipeline: per step attempt, the runner captures merged stdout/stderr, frames it as versioned NDJSON (runner-assigned timestamps, 16KB payload cap with UTF-8-safe splitting, ANSI preserved), write-through spools it to an append-only file under the job workspace, and uploads it with an offset-CAS protocol that resumes via a zero-length probe and dedupes. Output capture moves off the legacy in-memory 1MB buffer onto an `onOutput` sink.

  This consumes the `@shipfox/api-logs-dto` contract and the server `/logs` ingest route shipped by the log ingest foundation (ENG-439). Masking lands in a follow-up issue, so this pipeline must be enabled only once that exists.

- 360d06d: Add the runner log transform stage between capture and the spool: a streaming secret masker and GitHub-style group-marker detection. Captured output is masked before any byte reaches the plaintext spool, replacing the runner's own credentials (runner token and job lease token) plus every base64, base64url, URL-encoded, and hex form with `***` through a rolling lookbehind that never emits a secret split across capture-chunk or flush boundaries, and `::group::`/`::endgroup::` lines become `group_start`/`group_end` control records with the marker line swallowed. Output streams continuously (complete lines flush immediately, unterminated lines stream their masked safe prefix) so live tail, stream order, and frame timestamps are preserved. `@shipfox/redact` gains `secretWireForms` to derive a secret's wire forms, and `@shipfox/runner-protocol` exposes `runnerToken` so the orchestrator can assemble the mask set.

### Patch Changes

- 68e4022: Collapse the log stream `kind` into one stream per `(job, step, attempt)`. `kind` was modeled at the wrong layer: the runner already funnels every record through one spool and one offset axis, so the per-kind split (separate stream rows, identity, and ingest dispatch) was unnecessary server-side modeling. A reader now pulls every record for a step attempt and filters by the record `type` at read time, without passing a kind.
  - The append request drops the `kind` query param and `LogStreamClosedEvent` drops `kind`. `streamKind`/`StreamKind` and the `agent_session` line validator (`parseSessionLine`) are removed.
  - `attempt_streams` identity becomes `(job, step, attempt)`; the `kind` and now-dead `capped` columns are dropped (budget cap is signaled in-band by a `capped` tombstone and tracked in `job_accounting`). The close path injects `capped`/`runner_lost` tombstones uniformly.
  - `LOG_MAX_SESSION_LINE_BYTES` is removed and `LOG_APPEND_BODY_LIMIT_BYTES` is right-sized to 1 MiB. The runner's flush-window comment is corrected to match (the server body limit is now 1 MiB, no longer 8 MiB).

  Agent-session capture (its own record `type`(s) and runner producer) is deferred to the agent-sessions feature, which will emit those records into this same stream.

- d49ee4c: Forward agent step session entries into the logs module as opaque `agent_session` records: the runner tails the pi session file and forwards each verbatim entry over a shared log-stream sink, and the write path stores them with a configurable per-line size cap sized for inline base64 content.
- 2883ab4: Add a stream `kind` to the logs contract and harden the write path. Streams are now identified by `(job, step, attempt, kind)` with two kinds: `log_stream` (process output) and `agent_session` (verbatim, format-agnostic agent JSONL).
  - The record envelope drops `src` to `{v, ts}`; the stdout/stderr pipe moves to `stream` on output, and control records become a flat `type` discriminator with multi-level named groups (`group_id`/`parent_group_id`, capped depth with overflow flattening).
  - The append validator is split into an appendable union and a read union, so a forged server-only `capped`/`runner_lost` tombstone is rejected. `agent_session` lines are stored verbatim after a whole-line, fatal-UTF-8, JSON-well-formedness check within a configurable line cap; the budget cap never injects an in-band tombstone into a session, and close derives its `capped`/`truncated` flags out of band.
  - The append request carries `kind`; the shared body limit and session line cap are configurable with a startup invariant.

- 78d0f7f: Adds runner-produced command metadata groups and terminal failure context to command step log streams.
- Updated dependencies [e47f8da]
- Updated dependencies [7b175f5]
- Updated dependencies [f104ff2]
- Updated dependencies [68e4022]
- Updated dependencies [c7d8b39]
- Updated dependencies [f92122b]
- Updated dependencies [6c80f00]
- Updated dependencies [360d06d]
- Updated dependencies [4207772]
- Updated dependencies [d49ee4c]
- Updated dependencies [f8f339a]
- Updated dependencies [2883ab4]
- Updated dependencies [62720ea]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [a5c7562]
- Updated dependencies [6181819]
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/regex@0.2.0
  - @shipfox/api-logs-dto@0.1.0
  - @shipfox/runner-protocol@0.1.0
  - @shipfox/redact@0.1.0
  - @shipfox/config@1.2.0
