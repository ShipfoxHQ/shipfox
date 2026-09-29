---
'@shipfox/client-workflows': patch
'@shipfox/api-workflows': patch
---

Step and job failure copy uses plain words and active voice, and each message names the next action.

- **Rerun or new run:** a message says "rerun the job" when a workspace setting fixes the failure, and "start a new run" when the workflow file must change. A rerun keeps the workflow file of the original run.
- **`@shipfox/client-workflows`:** the step failure callouts and the job empty states use the new copy. The model availability callout names the model, for example "claude-opus-4-8 is not available in this workspace". `lease_expired`, `provider_lost`, `lifecycle_violation`, and `runner_lost` share one title; the failure code still tells them apart.
- **`@shipfox/api-workflows`:** failure annotations use the same wording as the step callouts. Annotations that already exist keep their old text until the step or job fails again.
