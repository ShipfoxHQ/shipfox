---
"@shipfox/api-workflows": patch
"@shipfox/api-runners": patch
---

Reports a failed purge of a deleted project to error monitoring. The Workflows and Runners sweeps that finish unfinished purges only logged a warning, so a purge that failed every minute never reached error monitoring.
