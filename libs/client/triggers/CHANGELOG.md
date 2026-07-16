# @shipfox/client-triggers

## 0.1.1

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/api-triggers-dto@2.0.0
  - @shipfox/client-ui@0.1.1
  - @shipfox/client-integrations@0.1.1
  - @shipfox/client-api@0.0.1
  - @shipfox/react-ui@0.3.0

## 0.1.0

### Minor Changes

- e4c6abf: Add reusable, source-keyed icon building blocks so any surface can render an integration or trigger icon without re-implementing the catalog lookup and fallback.

  `@shipfox/client-integrations` exposes `getIntegrationIcon(source)` and `<IntegrationIcon source />`, resolving an integration source (a connection `provider`, a run `trigger_source`, or a trigger event `source`) against the central `PROVIDER_CATALOG` with a neutral `componentLine` fallback. The catalog stays the single place each integration declares its icon; the integration gallery now renders `<IntegrationIcon>` instead of an inline lookup (no behavior change).

  New `@shipfox/client-triggers` package adds `getTriggerSourceIcon(source)` and `<TriggerSourceIcon source />`, built on the integration resolver. It recognizes the system trigger sources `manual` (a person fired the run) and `cron` (a schedule), and delegates every other source to the integration catalog. This is the building block for showing an icon on run rows and trigger events; adopting it on those surfaces lands separately.

- 2c352bb: Add the trigger events data layer to `@shipfox/client-triggers`: transport
  functions, colocated query keys, and React Query hooks for the workspace Events
  view. `useTriggerEventsInfiniteQuery(workspaceId, filters)` paginates the event
  history newest-first with cursor-based infinite scroll, and `useTriggerEventQuery(id)`
  loads a single event with its routing decisions. Filters (`source`, `event`,
  `outcome`, `from`, `to`) are normalized into a stable cache key so an out-of-order
  or duplicated `outcome` selection reuses the same cache entry. Consumes the
  `@shipfox/api-triggers-dto` contracts; no UI yet.
- e5d2f13: Add the workspace **Events** page in Settings: a filterable, cursor-paginated table of
  trigger events (status dot, source/event, routing summary, delivery id, received time)
  mounted at `/workspaces/$wid/settings/events` and wired into the settings sub-nav. Filters
  (date range, source, event, outcome) live in the URL via `validateSearch`, so a filtered
  view is shareable. Source and event filters are populated by a new
  `GET /trigger-events/facets` endpoint that returns each workspace's distinct source/event
  values with counts (top 50, backed by `(workspace_id, source)` / `(workspace_id, event)`
  indexes); the list still renders if facets fail to load.
- a460020: Add trigger event detail decisions with stored subscription names, run links, and payload inspection.

### Patch Changes

- Updated dependencies [43d7996]
- Updated dependencies [14e0bea]
- Updated dependencies [9018f0b]
- Updated dependencies [7fdfd72]
- Updated dependencies [2a3193f]
- Updated dependencies [f104ff2]
- Updated dependencies [7341569]
- Updated dependencies [d245be8]
- Updated dependencies [0f06c02]
- Updated dependencies [e4c6abf]
- Updated dependencies [e4c6abf]
- Updated dependencies [e5d2f13]
- Updated dependencies [a982f20]
- Updated dependencies [5d0676a]
- Updated dependencies [a460020]
- Updated dependencies [a35c2dc]
- Updated dependencies [58f7aef]
- Updated dependencies [5264a22]
- Updated dependencies [9674879]
- Updated dependencies [225c9a5]
- Updated dependencies [42443b4]
- Updated dependencies [24f131b]
- Updated dependencies [bb2a7bc]
- Updated dependencies [63bcac8]
- Updated dependencies [5eb06d0]
- Updated dependencies [4e13e5f]
- Updated dependencies [e92150d]
- Updated dependencies [8037501]
- Updated dependencies [0fb6018]
- Updated dependencies [c27a1ed]
- Updated dependencies [b8e49ff]
- Updated dependencies [8037501]
- Updated dependencies [6c0da64]
- Updated dependencies [07f8ff8]
- Updated dependencies [e457582]
- Updated dependencies [8b5c905]
- Updated dependencies [e192d86]
- Updated dependencies [5ec8367]
- Updated dependencies [f849131]
- Updated dependencies [a7da648]
- Updated dependencies [94bdcc5]
- Updated dependencies [a34c8ea]
- Updated dependencies [27770eb]
- Updated dependencies [8ac4bf4]
- Updated dependencies [3a0be6b]
- Updated dependencies [d42baf4]
- Updated dependencies [8037501]
- Updated dependencies [54bb8a3]
- Updated dependencies [f711e18]
  - @shipfox/client-integrations@0.1.0
  - @shipfox/react-ui@0.3.0
  - @shipfox/api-triggers-dto@0.1.0
  - @shipfox/client-api@0.0.1
  - @shipfox/client-ui@0.1.0
