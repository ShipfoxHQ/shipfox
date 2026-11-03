---
"@shipfox/api-runners": patch
"@shipfox/api-triggers": patch
---

Runner maintenance and the cron trigger tick use far fewer Temporal actions. Cron trigger throughput per minute is now set by `TRIGGER_CRON_FANOUT` and `TRIGGER_CRON_CLAIM_BATCH`; adding workers no longer raises it.
