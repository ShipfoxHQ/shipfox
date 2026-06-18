---
"@shipfox/api-logs-dto": minor
"@shipfox/api-logs": minor
"@shipfox/node-fastify": minor
---

Adds the logs module foundation: a stateless monolith module with its own schema, the runner-facing offset-CAS append endpoint (job-lease authenticated, idempotent, multi-instance safe), a per-job accrual budget with a cap tombstone, and an S3-compatible client targeting Garage at startup. The NDJSON v1 record contract lives in the new `@shipfox/api-logs-dto` package, and `@shipfox/node-fastify` gains a `createRawBodyPlugin({contentType, bodyLimit})` factory for byte-exact request bodies.
