# @shipfox/api-triggers

## 0.1.0

### Minor Changes

- a460020: Add trigger event detail decisions with stored subscription names, run links, and payload inspection.
- 5ec8367: Adds trigger event inspection endpoints with matching DTO schemas for listing received events and reading event decisions.

### Patch Changes

- ae7a63c: Adds daily dispatched outbox row retention with bounded cleanup batches and retention indexes on module outbox tables.
- 555299c: Add the append-only `triggers_received_events` and `triggers_decisions` tables that back the trigger event history. DB layer only: Drizzle schema, inferred types, and row→domain mappers, folded into the triggers module's baseline migration. No write or read path is wired yet.
- 9a4807d: Add the hourly Temporal prune cron and `TRIGGER_EVENT_RETENTION_DAYS` config var that bound trigger event history growth. The cron deletes `triggers_received_events` older than the retention window (default 30 days); `triggers_decisions` go with them via FK cascade.
- e5d2f13: Add the workspace **Events** page in Settings: a filterable, cursor-paginated table of
  trigger events (status dot, source/event, routing summary, delivery id, received time)
  mounted at `/workspaces/$wid/settings/events` and wired into the settings sub-nav. Filters
  (date range, source, event, outcome) live in the URL via `validateSearch`, so a filtered
  view is shareable. Source and event filters are populated by a new
  `GET /trigger-events/facets` endpoint that returns each workspace's distinct source/event
  values with counts (top 50, backed by `(workspace_id, source)` / `(workspace_id, event)`
  indexes); the list still renders if facets fail to load.
- a982f20: Stop a permanently-broken trigger subscription from starving its siblings or wedging the outbox. Integration dispatch now attempts every matched subscription and classifies each `runWorkflow` failure: a permanent error (deleted definition or project mismatch) is recorded and skipped, while a transient one re-throws so the outbox replays the event and converges. The event reaches a terminal outcome once no transient error remains (`routed` when any run was created, otherwise the new `errored` outcome), with a guarded write that never records `errored` over an event that already produced a run. The manual-fire path records the same terminal outcome, and `@shipfox/api-workflows` exports an `isPermanentRunWorkflowError` classifier. The trigger-events read API (`triggerEventOutcomeSchema`) accepts the new `errored` outcome for serialization and filtering.
- 6077301: Adds shared timestamp/id keyset pagination helpers and migrates workflow run and trigger event lists onto them.
- 3bea87f: Adds a typed `subscriberFactory` that binds each outbox event name to its payload type at construction, so subscriber handlers receive a typed `(payload, event)` and the per-handler `event.payload as X` casts are gone; a private brand makes the factory the only way to build a module subscriber.
- b74f635: Adds workflow run interpolation context resolution while preserving authored step configuration for reruns and diagnostics.
- Updated dependencies [eb40964]
- Updated dependencies [5c18360]
- Updated dependencies [2c156d2]
- Updated dependencies [34ba284]
- Updated dependencies [59ba68b]
- Updated dependencies [7a9943d]
- Updated dependencies [b9c3f32]
- Updated dependencies [a81b68c]
- Updated dependencies [115655e]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [e47f8da]
- Updated dependencies [736249b]
- Updated dependencies [2bc5595]
- Updated dependencies [7b175f5]
- Updated dependencies [97162dd]
- Updated dependencies [b694b09]
- Updated dependencies [c47be09]
- Updated dependencies [f9f059e]
- Updated dependencies [940696a]
- Updated dependencies [f3614ae]
- Updated dependencies [f98c2be]
- Updated dependencies [e9396c9]
- Updated dependencies [ae7a63c]
- Updated dependencies [5729548]
- Updated dependencies [f92122b]
- Updated dependencies [e250c4c]
- Updated dependencies [b525dcd]
- Updated dependencies [f8f339a]
- Updated dependencies [857fd73]
- Updated dependencies [e5d2f13]
- Updated dependencies [a982f20]
- Updated dependencies [998eba3]
- Updated dependencies [a460020]
- Updated dependencies [3afb7e3]
- Updated dependencies [139e3be]
- Updated dependencies [247cbd6]
- Updated dependencies [c652a68]
- Updated dependencies [121b42e]
- Updated dependencies [75520ff]
- Updated dependencies [c0a883c]
- Updated dependencies [b8e49ff]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [3bea87f]
- Updated dependencies [d69b164]
- Updated dependencies [2fb3e87]
- Updated dependencies [b74f635]
- Updated dependencies [5ec8367]
- Updated dependencies [ef1e917]
- Updated dependencies [61de795]
- Updated dependencies [f9153e8]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [6181819]
- Updated dependencies [e699508]
- Updated dependencies [9c149d1]
- Updated dependencies [f9bf446]
- Updated dependencies [b8919da]
- Updated dependencies [8ecc121]
  - @shipfox/api-workflows@0.1.0
  - @shipfox/api-workflows-dto@1.0.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/api-definitions-dto@0.0.1
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/api-integration-core-dto@0.1.0
  - @shipfox/api-projects@0.0.1
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-temporal@0.1.1
  - @shipfox/node-module@0.1.0
  - @shipfox/node-outbox@0.1.0
  - @shipfox/api-triggers-dto@0.1.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/config@1.2.0
