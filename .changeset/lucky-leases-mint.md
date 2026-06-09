---
"@shipfox/api-runners": minor
"@shipfox/api-runners-dto": minor
---

Adds a job lease capability token (HS256, `verifyJobLeaseToken` plus the claims schema) so runner step calls can be authenticated in-process without a hop back to Scheduling.
