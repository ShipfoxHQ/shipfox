---
"@shipfox/client-triggers": minor
"@shipfox/api-triggers": patch
"@shipfox/api-triggers-dto": patch
"@shipfox/client-workspace-settings": patch
"@shipfox/client-router": patch
---

Add the workspace **Events** page in Settings: a filterable, cursor-paginated table of
trigger events (status dot, source/event, routing summary, delivery id, received time)
mounted at `/workspaces/$wid/settings/events` and wired into the settings sub-nav. Filters
(date range, source, event, outcome) live in the URL via `validateSearch`, so a filtered
view is shareable. Source and event filters are populated by a new
`GET /trigger-events/facets` endpoint that returns each workspace's distinct source/event
values with counts (top 50, backed by `(workspace_id, source)` / `(workspace_id, event)`
indexes); the list still renders if facets fail to load.
