---
"@shipfox/api-agent": minor
"@shipfox/api-agent-dto": minor
"@shipfox/client-api": minor
---

Streams conversation turns to the browser over server-sent events.

- **Agent:** `GET /conversations/:conversationId/stream?after_seq=<n>` sends `queued`, `item`, `delta`, `reset`, and `turn` events, with a comment heartbeat every 15 seconds. It closes when the turn ends or after 5 minutes. A reconnect gets a `reset` and the running call's text from its first chunk. Browser origins that the API allows can read it.
- **Agent DTO:** `conversationStreamQuerySchema` and `conversationStreamEventSchema` describe the request and the events.
- **Client API:** `checkedApiEventStream` opens an event stream with `fetch` and the bearer token, and validates each message.
