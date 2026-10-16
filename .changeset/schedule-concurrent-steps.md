---
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
---

Schedules concurrent steps on the server and the runner.

- **Protocol:** the `next` request takes an `in_flight` list of the step attempts the runner holds. Each `next` response carries `cancel_step_ids`, and a `step` response says whether it is `background`. A `report` accepts `cancelled` for an attempt that a `cancel` step is stopping, which confirms that its process exited. The step DTO and the job detail steps gain `background` and `parallel_group`.
- **Scheduling:** a running background step lets later steps start, and any other running step blocks them. A `wait` step blocks until every step it names has ended, and it fails when one of them failed without `continue_on_error`. A `cancel` step stops running targets without waiting for them. A checkout, an action post, and a step whose earlier attempt is stopping wait until the stopped process is confirmed, and the job does not finish before that. A background step no longer counts for the job result.
- **Limit:** `WORKFLOWS_MAX_CONCURRENT_STEPS` caps the steps of one job that run at the same time. The default is 20.
- **Metrics:** adds the `workflows_step_cancelled` counter, labeled by `reason`.
