---
"@shipfox/api-triggers": patch
"@shipfox/api-triggers-dto": patch
---

Adds the cron firing engine: a once-per-minute tick fans out bounded drain activities that claim due schedules (FOR UPDATE SKIP LOCKED), advance their next fire time, and fire the workflow deduplicated and crash-safe, recorded in trigger history with a `cron` origin and surfaced through cron fire and backlog metrics.
