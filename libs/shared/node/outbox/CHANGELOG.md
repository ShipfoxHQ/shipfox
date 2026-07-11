# @shipfox/node-outbox

## 0.1.0

### Minor Changes

- 5729548: Stuck-job expiry now reaps a bounded batch in one transaction instead of N+1: a single `DELETE … RETURNING` (oldest-first, `FOR UPDATE SKIP LOCKED`, capped at 100 per tick) feeds a multi-row outbox insert via the new `writeOutboxEvents` helper. Behavior is unchanged (same rows reaped, one `runners.job.lease_expired` event per reaped job, same orphan-pending sweep).

### Patch Changes

- ae7a63c: Adds daily dispatched outbox row retention with bounded cleanup batches and retention indexes on module outbox tables.
- Updated dependencies [5707d6d]
- Updated dependencies [6077301]
  - @shipfox/node-drizzle@0.1.0
