---
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/client-workflows": minor
---

Adds a "Last run" column to the Workflows tab of the Automations page. It shows a status glyph and the relative time of the latest synced run of each workflow, or "No runs yet". Dev runs never count.

- **`@shipfox/api-workflows`:** adds `GET /workflows/runs/latest`, which takes a `project_id` and up to 100 comma-separated `definition_ids` and returns the newest synced run of each one. A workflow with no synced run is left out.
- **`@shipfox/api-workflows-dto`:** adds `workflowLatestRunsQuerySchema`, `workflowLatestRunsResponseSchema`, and their types.
- **`@shipfox/client-workflows`:** the table shows the latest synced run of each workflow and keeps it current while the run is going. A failed page marks only its own rows as unavailable, and starting a manual run refreshes the column.
