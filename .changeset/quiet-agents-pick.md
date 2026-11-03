---
"@shipfox/api-agent": minor
"@shipfox/api-agent-dto": minor
"@shipfox/api-server": minor
"@shipfox/client-chat": minor
---

Project agent files now shape conversations, and a project can have custom agents.

- **Built-in agent:** the `instructions` of `shippy.yaml` append to the pinned system prompt of a new conversation. Its `provider` and `model` apply from the next turn. A running conversation keeps its prompt.
- **Custom agents:** a conversation can start with `agent_key` set to a custom agent, which uses its own full prompt. The conversation stores the agent file's content hash. A deleted agent leaves its conversations readable and refuses new messages and retries.
- **API:** `GET /projects/:projectId/agents` lists the built-in agent and the custom agents with any file error. `createAgentModule` takes an optional `definitions` client.
- **Chat panel:** a picker appears in a new conversation when the project has custom agents. The panel shows an invalid agent file and a deleted agent.
