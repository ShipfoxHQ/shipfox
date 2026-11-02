---
"@shipfox/api-agent": minor
"@shipfox/api-agent-dto": minor
"@shipfox/api-server": minor
---

Store private web conversations and expose their API.

- **Storage:** a conversation is an append-only timeline of pi session entries, stored unchanged, so thinking and signatures survive.
- **Privacy:** entries, titles, and stream chunks are encrypted with the workspace data key. System entries, page notes, and signatures never reach a client.
- **Routes:** list and create under `/projects/:projectId/conversations`, and get, read items, post a message, mark read, and delete under `/conversations/:conversationId`. Anyone but the owner gets a 404.
- **DTOs:** `@shipfox/api-agent-dto` exports the conversation schemas and a closed `pageContextSchema`. Items carry `SessionView` rows, or dedicated run result and turn notice DTOs.
- **Composition:** `createAgentModule` accepts an optional `projects` client. The conversation routes are mounted only when it is present, so a custom `agentModuleFactory` must forward it.
