---
"@shipfox/api-workflows-dto": minor
"@shipfox/api-triggers-dto": minor
"@shipfox/api-workflows": patch
"@shipfox/api-triggers": patch
"@shipfox/api-agent-access": patch
"@shipfox/api-integration-shipfox": patch
"@shipfox/client-triggers": patch
---

Stops runs that check out the project's source while its connection is missing, disabled, or in error. Trigger starts and listening-job deliveries now fail with the `source-connection-unavailable` known error. Cron records an errored tick and sends no failure alerts, and the next tick after recovery starts a run. A manual fire returns 422.
