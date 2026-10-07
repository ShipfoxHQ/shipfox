---
"@shipfox/expression": minor
"@shipfox/api-integration-shipfox-dto": minor
"@shipfox/api-integration-shipfox": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-workflows": patch
"@shipfox/api-triggers": patch
"@shipfox/api-integration-core": patch
"@shipfox/workflow-templates": patch
---

Workflows can link to their runs. `run.url` in the run context, `event.run.url` on Shipfox run and job events, and `url` on the `start_workflow_run` output hold the run permalink, built from `CLIENT_BASE_URL`. Replaying a Shipfox event stored without `run.url` fills it in. The `slack-dispatcher` and `report-failed-runs` templates use these links instead of `https://app.shipfox.io/runs/`.
