---
"@shipfox/api-agent": minor
"@shipfox/api-agent-dto": minor
"@shipfox/api-server": minor
---

Store private web conversations and expose their API.

- **Storage:** the `agent` namespace gains `agent_conversations`, `agent_conversation_items`, `agent_turns`, and `agent_turn_stream_chunks`. Bodies, titles, and stream chunks are sealed with the workspace data key.
- **Routes:** list and create under `/projects/:projectId/conversations`, and get, read items, post a message, mark read, and delete under `/conversations/:conversationId`. Anyone but the owner gets a 404.
- **DTOs:** `@shipfox/api-agent-dto` exports the conversation schemas and a closed `pageContextSchema`.
- **Composition:** `createAgentModule` accepts an optional `projects` client. The conversation routes are mounted only when it is present, so a custom `agentModuleFactory` must forward it.
