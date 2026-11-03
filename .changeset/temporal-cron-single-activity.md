---
"@shipfox/api-runners": patch
"@shipfox/api-triggers": patch
---

The once-a-minute Temporal crons use one activity per run, which cuts their Temporal actions by about 80%.

- **Runners:** the stuck-job detector runs its eight maintenance steps in `runMaintenanceSweepActivity` instead of eight activities. The four cleanup steps stay best effort.
- **Triggers:** the cron tick runs its `TRIGGER_CRON_FANOUT` drains in parallel inside `runCronTickActivity` instead of one activity per drain plus one to read the fanout. All the drains run on one worker, so adding pods no longer raises how many schedules fire per minute.
