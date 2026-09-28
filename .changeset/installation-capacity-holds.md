---
"@shipfox/api-runners": minor
"@shipfox/api-runners-dto": minor
---

Records capacity holds for managed installation runners when the provisioning policy sets `placement`, so each runner counts against its workspace until it stops. Adds the `getWorkspaceCapacityUsage` inter-module read and the `GET /admin/runners/workspaces/:workspaceId/capacity` admin route. Holds do not refuse claims yet.
