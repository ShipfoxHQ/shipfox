---
'@shipfox/api-integration-linear': minor
'@shipfox/api-integration-core': patch
---

The Linear provider reads agent sessions as interactions. `agentSession.created` is a request with the trigger, team, labels, project, and issue identifier as context, `agentSession.prompted` is a follow-up, and a prompt with the `stop` signal is a stop. The webhook path posts a `thought` activity before it publishes the event, so Linear doesn't mark a new session unresponsive. `LinearApiClient` gains `createAgentActivity` and `getIssueContext`.
