---
"@shipfox/api-workflows": minor
---

Track per-step execution attempts: add a `step_attempts` history table and a `steps.current_attempt` column, open a running attempt at dispatch and finalize it at report, and make step-result reporting attempt-aware (idempotent duplicate reports, rejected future attempts, no-op stale attempts).
