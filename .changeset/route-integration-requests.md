---
"@shipfox/api-agent": minor
"@shipfox/api-agent-dto": minor
"@shipfox/api-triggers": minor
"@shipfox/api-triggers-dto": minor
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-server": patch
"@shipfox/client-triggers": patch
---

Routes requests from integrations that support interactions to agents. An unowned request starts a conversation with the Shippy of the workspace's oldest project. A request on an owned key, a follow-up, or a stop reaches the conversation that owns its key, and a follow-up or stop with no owner is dropped. A replayed event creates one conversation. Triggers records each result as an `agent` decision: `owner`, `default`, or `dropped`. Agent adds `routeInteraction` and the origin columns on conversations.
