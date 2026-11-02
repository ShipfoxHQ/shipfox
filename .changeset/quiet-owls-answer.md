---
"@shipfox/api-agent": minor
"@shipfox/api-server": patch
"@shipfox/node-module": minor
"@shipfox/node-egress-guard": minor
"@shipfox/workflow-templates": minor
---

Runs agent conversation turns on Temporal, with model calls on the server and no runner.

- **Agent:** `createAgentModule` takes an `integrations` client. With it and `projects`, the module runs one `agentConversationWorkflow` per conversation on the `agent-conversation` queue. Its activities rebuild each prompt from the stored pi entries, stream the reply, run tools through `integrations.callTool`, and store each result once. The first entry pins the base prompt and tools. A turn stops after 25 model calls.
- **Server:** the default composition passes the Integrations client to Agent.
- **Module:** a worker can set `maxConcurrentActivityTaskExecutions`.
- **Egress guard:** `assertEgressAllowed` takes an optional `lookup`, so a caller can check the addresses it connects to.
- **Templates:** `getBuiltInAgentPrompt` reads the base prompt of a built-in agent. The package embeds `assets/agents/shippy.md`.
