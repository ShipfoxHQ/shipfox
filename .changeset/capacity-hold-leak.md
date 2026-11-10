---
"@shipfox/api-runners": patch
---

Each runner of a multi-runner launch now binds its own capacity hold, and unbound holds are released when their reservation is consumed or no longer exists. The maintenance sweep also releases holds that leaked before this fix.
