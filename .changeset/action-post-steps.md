---
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-agent-access-dto": minor
---

Shipfox runs the `post` entry of an action at the end of the job.

- **Post rows:** a job execution gets one `post` step for each action step that declares `post`, after every authored step, in reverse step order. The row is named `Post <step name>`, has no key, and is skipped with the `main_not_started` reason when its main entry never reached the runner.
- **Dispatch:** a post runs with the inputs, env, secret bindings, tool grants, state, and exported environment of the last attempt of its main step that reached the runner, also after a gate restart skipped the step.
- **Job result:** a failed post with `post_failure: warn` leaves the job result and `execution.failed` unchanged. With `fail`, it fails the job.
- **API:** the step type gains `post`, the step status reason gains `main_not_started`, and a post row in a step summary carries `main_step_id` and `affects_job`. The agent access read tools return the same.
