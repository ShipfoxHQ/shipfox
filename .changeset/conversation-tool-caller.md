---
"@shipfox/api-integration-core": major
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-integration-shipfox": minor
"@shipfox/api-integration-spi": major
---

Adds a `conversation` caller to `integrations.callTool`, so a server-side agent turn can call tools with no job lease.

- **Breaking:** `AgentToolsCallerContext` and `IntegrationToolCallCaller` become unions. Code that reads `runId`, `jobExecutionId`, or `stepId` from a caller must narrow on the caller kind first.
- **Provider contract:** `AgentToolsProvider` gains an optional `conversationCatalog`. A provider without one offers a conversation nothing.
- **Inter-module contract:** `listConversationTools` returns the tools to offer, and `callTool` refuses any other tool for a conversation caller.
- **Project scoping:** on the `shipfox` provider, a conversation caller can't pass `project_id`, can't call `list_projects` or `start_workflow_run`, gets `not-found` for a run or step in another project, and sees a null `parent_run` when the parent is in another project. Lease callers are unchanged.
- **Audit:** tool call records name the conversation caller with its project, conversation, turn, and call item. The `integrations_agent_tool_call` metric adds a `conversation` value to its `caller` label only.
