---
"@shipfox/api-logs-dto": patch
"@shipfox/api-logs": patch
"@shipfox/runner-protocol": patch
"@shipfox/runner-orchestration": patch
"@shipfox/runner-logs": patch
---

Add a stream `kind` to the logs contract and harden the write path. Streams are now identified by `(job, step, attempt, kind)` with two kinds: `log_stream` (process output) and `agent_session` (verbatim, format-agnostic agent JSONL).

- The record envelope drops `src` to `{v, ts}`; the stdout/stderr pipe moves to `stream` on output, and control records become a flat `type` discriminator with multi-level named groups (`group_id`/`parent_group_id`, capped depth with overflow flattening).
- The append validator is split into an appendable union and a read union, so a forged server-only `capped`/`runner_lost` tombstone is rejected. `agent_session` lines are stored verbatim after a whole-line, fatal-UTF-8, JSON-well-formedness check within a configurable line cap; the budget cap never injects an in-band tombstone into a session, and close derives its `capped`/`truncated` flags out of band.
- The append request carries `kind`; the shared body limit and session line cap are configurable with a startup invariant.
