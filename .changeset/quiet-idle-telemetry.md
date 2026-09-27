---
"@shipfox/node-opentelemetry": minor
"@shipfox/node-outbox": minor
"@shipfox/api-dispatcher": patch
"@shipfox/api-runners": patch
"@shipfox/api-workflows": patch
---

Reduces telemetry from idle polling. Postgres queries create spans only inside a parent span, requests to the metrics ports create no spans, and the SDK drops the generic HTTP server duration histogram. Adds `withoutTracing` to `@shipfox/node-opentelemetry`. Fastify spans for 4xx client errors no longer carry an error status. They record the reason as `error.type` and `error.message` attributes instead of an exception event.

The outbox drainer backs off to 2 seconds while the outbox stays empty. Adds `onOutboxWrite` to `@shipfox/node-outbox`. A local outbox write ends the drainer's idle wait. Dispatched events, tool-step calls, and concurrency repairs get their own spans. Runner assignment long polls trace only their first read. Registration from a runner that predates capability negotiation returns a `runner-upgrade-required` code with an upgrade message.
