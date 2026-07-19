# @shipfox/node-outbox

## 0.2.2

### Patch Changes

- Updated dependencies [bbba3b7]
  - @shipfox/node-drizzle@0.3.0

## 0.2.1

### Patch Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.
- Updated dependencies [1b0d344]
  - @shipfox/node-drizzle@0.2.1

## 0.2.0

### Minor Changes

- 705dd43: Publishes the supported PostgreSQL outbox API with external-consumer verification and operational documentation.

## 0.1.1

### Patch Changes

- Updated dependencies [ec75cd5]
  - @shipfox/node-drizzle@0.2.0

## 0.1.0

### Minor Changes

- 5729548: Stuck-job expiry now reaps a bounded batch in one transaction instead of N+1: a single `DELETE … RETURNING` (oldest-first, `FOR UPDATE SKIP LOCKED`, capped at 100 per tick) feeds a multi-row outbox insert via the new `writeOutboxEvents` helper. Behavior is unchanged (same rows reaped, one `runners.job.lease_expired` event per reaped job, same orphan-pending sweep).

### Patch Changes

- ae7a63c: Adds daily dispatched outbox row retention with bounded cleanup batches and retention indexes on module outbox tables.
- Updated dependencies [5707d6d]
- Updated dependencies [6077301]
  - @shipfox/node-drizzle@0.1.0
