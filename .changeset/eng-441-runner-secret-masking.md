---
"@shipfox/redact": minor
"@shipfox/runner-logs": minor
"@shipfox/runner-protocol": minor
"@shipfox/runner-orchestration": patch
---

Add the runner log transform stage between capture and the spool: a streaming secret masker and GitHub-style group-marker detection. Captured output is masked before any byte reaches the plaintext spool, replacing the runner's own credentials (runner token and job lease token) plus every base64, base64url, URL-encoded, and hex form with `***` through a rolling lookbehind that never emits a secret split across capture-chunk or flush boundaries, and `::group::`/`::endgroup::` lines become `group_start`/`group_end` control records with the marker line swallowed. Output streams continuously (complete lines flush immediately, unterminated lines stream their masked safe prefix) so live tail, stream order, and frame timestamps are preserved. `@shipfox/redact` gains `secretWireForms` to derive a secret's wire forms, and `@shipfox/runner-protocol` exposes `runnerToken` so the orchestrator can assemble the mask set.
