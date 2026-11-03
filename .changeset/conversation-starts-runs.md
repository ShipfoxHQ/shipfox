---
"@shipfox/api-agent": minor
"@shipfox/api-agent-dto": minor
"@shipfox/api-integration-core": patch
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-integration-shipfox": minor
"@shipfox/api-integration-spi": minor
"@shipfox/api-server": patch
"@shipfox/api-triggers": minor
"@shipfox/api-triggers-dto": minor
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/client-chat": minor
"@shipfox/client-workflows": minor
"@shipfox/workflow-templates": patch
---

A conversation can start workflow runs, with a limit on how many it starts without a person writing.

- **Start tool:** `start_workflow_run` is now offered to conversations. It starts a root run in the conversation's project for the conversation owner, and its idempotency key is `conversation:<conversationId>:<callItemId>`, so a repeated call returns the same run. The conversation caller context now carries `agentKey`.
- **Run budget:** `claimConversationRunStart` on the agent inter-module contract spends one of five run starts. A message from a person resets the count. At the limit, the tool returns `run-budget-exhausted` and tells the agent to ask the user. A repeated call doesn't spend the budget again.
- **Manual trigger:** `fireManualTrigger` and the manual trigger payload take an optional `conversation` with `id`, `agentKey`, and `provider`. The workflows inter-module contract gains `hasRunForIdempotencyKey`.
- **Run reads:** run list items and the run overview header return `conversation` with `agent_key`, `provider`, and `author_user_id`, and never the conversation id.
- **Client:** the run list shows `via Shippy`, the run summary shows `Started by <author> via Shippy`, and the chat shows a `Run started` row that never joins a group of reads. The panel copy and suggested prompts say that Shippy can start work.
- **Shippy prompt:** a conversation pinned before this change says it can't start runs and suggests a new conversation.
