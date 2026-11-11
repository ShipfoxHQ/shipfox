---
"@shipfox/api-triggers": patch
---

`@temporalio/activity` is now a production dependency. The cron drain activity imports it at runtime, so an install without development dependencies failed to load the package.
