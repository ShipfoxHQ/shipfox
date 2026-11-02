---
"@shipfox/api-agent": minor
"@shipfox/api-agent-dto": minor
"@shipfox/client-api": minor
"@shipfox/client-agent": patch
---

Streams conversation turns to the browser over server-sent events.

- **Agent:** `GET /conversations/:conversationId/stream?after_seq=<n>` tails Postgres every 150 ms, so any API process can serve a turn that runs on another. It sends `queued`, `item`, `delta`, `reset`, and `turn` events, with a comment heartbeat every 15 seconds. It ends with the turn or after 5 minutes. A reconnect gets a `reset` and the running call's text from its first chunk. The route copies the CORS headers onto the hijacked response.
- **Agent DTO:** `conversationStreamQuerySchema` and `conversationStreamEventSchema` describe the request and the events.
- **Client API:** `checkedApiEventStream` opens an event stream with `fetch` and the bearer token, and validates each message.
- **Client agent:** the conversation stream hook reconnects after a dropped connection and clears partial text when a model call is retried.
