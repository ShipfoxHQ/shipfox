---
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-logs-dto": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/client-logs": minor
"@shipfox/api-logs": patch
"@shipfox/api-workflows": patch
"@shipfox/client-workflows": patch
---

Adds `timed_out` and `run_cancelled` log records, exposes terminal causes on step-attempt termination events, and renders timeout, cancellation, and runner loss distinctly.
