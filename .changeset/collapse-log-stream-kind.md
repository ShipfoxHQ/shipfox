---
"@shipfox/api-logs-dto": patch
"@shipfox/api-logs": patch
"@shipfox/runner-protocol": patch
"@shipfox/runner-orchestration": patch
"@shipfox/runner-logs": patch
---

Collapse the log stream `kind` into one stream per `(job, step, attempt)`. `kind` was modeled at the wrong layer: the runner already funnels every record through one spool and one offset axis, so the per-kind split (separate stream rows, identity, and ingest dispatch) was unnecessary server-side modeling. A reader now pulls every record for a step attempt and filters by the record `type` at read time, without passing a kind.

- The append request drops the `kind` query param and `LogStreamClosedEvent` drops `kind`. `streamKind`/`StreamKind` and the `agent_session` line validator (`parseSessionLine`) are removed.
- `attempt_streams` identity becomes `(job, step, attempt)`; the `kind` and now-dead `capped` columns are dropped (budget cap is signaled in-band by a `capped` tombstone and tracked in `job_accounting`). The close path injects `capped`/`runner_lost` tombstones uniformly.
- `LOG_MAX_SESSION_LINE_BYTES` is removed and `LOG_APPEND_BODY_LIMIT_BYTES` is right-sized to 1 MiB. The runner's flush-window comment is corrected to match (the server body limit is now 1 MiB, no longer 8 MiB).

Agent-session capture (its own record `type`(s) and runner producer) is deferred to the agent-sessions feature, which will emit those records into this same stream.
