---
"@shipfox/node-fastify": minor
---

Writes one `request completed` log line per request, with the request, status, route, and duration, instead of Fastify's two request lines. A client error handled by the default error handler adds a `clientError` field to that line instead of writing its own record. Route error handlers now also map errors thrown by the handler before tracing records them.

Removes the `fastify_request_total` counter; use `fastify_request_duration_count`, which has the same labels. `ClientError` exposes `statusCode`, so tracing can tell client errors apart.
