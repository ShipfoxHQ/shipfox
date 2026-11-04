---
'@shipfox/api-integration-linear': minor
---

The Linear provider replies to agent sessions with activities. `sendReply` posts a `response` activity, or an `error` activity for a failed turn, and the reply of a stopped turn confirms the stop. A refused activity is `undeliverable`, and a rate limit, timeout, or outage is retried. `reportProgress` posts each tool call as an ephemeral `action` activity and adds links to the session's external URLs, which keeps the link of every run. `LinearApiClient` gains `addAgentSessionExternalUrls`, and `createAgentActivity` accepts `action`, `response`, and `error` content and an `ephemeral` flag.
