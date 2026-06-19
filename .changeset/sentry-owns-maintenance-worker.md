---
"@shipfox/api-integration-core": patch
"@shipfox/api-integration-sentry": patch
---

Move the Sentry unclaimed-installation cleanup cron out of `@shipfox/api-integration-core` into `@shipfox/api-integration-sentry`, which now owns its own Temporal maintenance worker. `core` aggregates per-integration workers from enabled providers instead of special-casing Sentry, keeping the integration dependency graph a tree (providers depend only on `*-core-dto`, never on `core`). The unclaimed-installation retention window is now configurable via `SENTRY_UNCLAIMED_INSTALLATION_RETENTION_DAYS` (default 7).
