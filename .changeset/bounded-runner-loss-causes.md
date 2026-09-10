---
"@shipfox/api-runners-dto": minor
"@shipfox/api-runners": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-workflows": minor
"@shipfox/api-agent-access-dto": minor
"@shipfox/client-workflows": minor
"@shipfox/api-logs": minor
---

Publish lease_expired, provider_lost, and lifecycle_violation as job execution status reasons; add the optional cause field and RunnerJobLossCauseDto/runnerJobLossCauseSchema to the lease-expired event, with runner_lost fallback when provider state is unavailable.
