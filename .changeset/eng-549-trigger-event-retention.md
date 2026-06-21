---
"@shipfox/api-triggers": patch
---

Add the hourly Temporal prune cron and `TRIGGER_EVENT_RETENTION_DAYS` config var that bound trigger event history growth. The cron deletes `triggers_received_events` older than the retention window (default 30 days); `triggers_decisions` go with them via FK cascade.
