---
"@shipfox/node-outbox": minor
"@shipfox/api-runners": patch
---

Stuck-job expiry now reaps a bounded batch in one transaction instead of N+1: a single `DELETE … RETURNING` (oldest-first, `FOR UPDATE SKIP LOCKED`, capped at 100 per tick) feeds a multi-row outbox insert via the new `writeOutboxEvents` helper. Behavior is unchanged (same rows reaped, one `runners.job.lease_expired` event per reaped job, same orphan-pending sweep).
