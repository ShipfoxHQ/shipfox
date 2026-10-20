---
"@shipfox/node-drizzle": patch
"@shipfox/node-error-monitoring": patch
"@shipfox/node-fastify": patch
"@shipfox/node-feature-flags": patch
"@shipfox/node-log": patch
"@shipfox/node-opentelemetry": patch
"@shipfox/node-outbox": patch
"@shipfox/node-postgres": patch
---

Two installed copies of these packages now share their process state through `@shipfox/node-process-state` slots: the Postgres pool, the Fastify app, auth methods, and client errors, the default logger, the OpenTelemetry SDK, meter provider, and base logger, the OpenFeature domain counter, outbox write listeners, reported errors, and precise cursor timestamps. `@shipfox/node-module` now reports a duplicate copy of any of them at startup.
