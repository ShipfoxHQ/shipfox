---
'@shipfox/api-triggers': minor
'@shipfox/api-triggers-dto': minor
---

Adds `GET /workflow-definitions/readiness`, which reports for up to 100 definitions what the workspace still lacks before their runs can start cleanly. Each issue says where it is read and whether it blocks the run from starting or fails a job after the run starts.
