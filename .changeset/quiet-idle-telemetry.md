---
"@shipfox/node-opentelemetry": minor
---

Postgres queries create spans only inside a parent span. Requests to the instance and service metrics ports create no spans, and the SDK drops the `http.server.duration` and `http.server.request.duration` histograms. Fastify spans for 4xx client errors no longer carry an error status; they record the reason as `error.type` and `error.message` attributes instead of an exception event. Adds `withoutTracing`, which runs a function without creating spans.
