---
"@shipfox/api-agent": minor
"@shipfox/api-agent-dto": minor
"@shipfox/api-integration-shipfox": minor
"@shipfox/workflow-templates": patch
---

A run started from a conversation now reports its result back to that conversation, even days later.

- **When:** the result arrives when the run settles, meaning its one-shot jobs finished and a listener keeps it open, or when it ends. A cancelled or timed-out run never looks settled, and a very large run reports only when it ends. Each attempt reports once, and a rerun reports its own result.
- **Reliability:** a result that failed to arrive is delivered once the fault clears, and a check that stayed requested for over a minute is run again by the next recovery sweep.
- **Shippy:** reads the finished jobs at settled to find outputs such as `pr_url`, and reports an ended run's outputs with its status.
- **Integration:** `@shipfox/api-agent-dto` adds the `registerConversationRun` inter-module method, which `start_workflow_run` calls for a conversation. `createAgentModule` now needs the `workflows` client to deliver results.
