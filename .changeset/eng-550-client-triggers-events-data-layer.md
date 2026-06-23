---
"@shipfox/client-triggers": minor
---

Add the trigger events data layer to `@shipfox/client-triggers`: transport
functions, colocated query keys, and React Query hooks for the workspace Events
view. `useTriggerEventsInfiniteQuery(workspaceId, filters)` paginates the event
history newest-first with cursor-based infinite scroll, and `useTriggerEventQuery(id)`
loads a single event with its routing decisions. Filters (`source`, `event`,
`outcome`, `from`, `to`) are normalized into a stable cache key so an out-of-order
or duplicated `outcome` selection reuses the same cache entry. Consumes the
`@shipfox/api-triggers-dto` contracts; no UI yet.
