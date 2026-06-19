---
"@shipfox/runner-logs": minor
"@shipfox/runner-execution": minor
"@shipfox/runner-protocol": minor
"@shipfox/runner-orchestration": patch
---

Add the runner-side log capture pipeline: per step attempt, the runner captures merged stdout/stderr, frames it as versioned NDJSON (runner-assigned timestamps, 16KB payload cap with UTF-8-safe splitting, ANSI preserved), write-through spools it to an append-only file under the job workspace, and uploads it with an offset-CAS protocol that resumes via a zero-length probe and dedupes. Output capture moves off the legacy in-memory 1MB buffer onto an `onOutput` sink.

This consumes the `@shipfox/api-logs-dto` contract and the server `/logs` ingest route shipped by the log ingest foundation (ENG-439). Masking lands in a follow-up issue, so this pipeline must be enabled only once that exists.
