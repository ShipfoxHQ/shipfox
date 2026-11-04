---
"@shipfox/api-agent": minor
"@shipfox/api-agent-dto": minor
"@shipfox/api-integration-shipfox": minor
"@shipfox/workflow-templates": patch
---

Deliver the result of a run a conversation started when the run settles or ends.

- **Links:** `start_workflow_run` links the run to the conversation through the new `registerConversationRun` inter-module method. The runtime does this, not the model.
- **Delivery:** a subscriber for `workflows.job.activated`, `workflows.job.terminated`, and `workflows.workflow_run.terminated` checks the latest attempt. When it ended, or settled, each linked conversation gets a sealed `run_result` entry as a queued input, and the agent replies. One attempt delivers one result.
- **Settled:** the attempt isn't terminal, every one-shot job is, and a job has `listener_status = 'listening'`. Cancel and timeout never look settled, and a very large run delivers only when it ends.
- **Recovery:** `recoverConversationsCron` runs the checks that stayed requested for over a minute, so a failed check delivers once the fault clears. `createAgentModule` needs the `workflows` client, besides the clients that run turns.
- **Prompt:** Shippy reads finished jobs with `get_workflow_job` at settled to find outputs such as `pr_url`.
