---
"@shipfox/api-agent-access": patch
"@shipfox/api-auth": patch
"@shipfox/api-projects": patch
"@shipfox/api-runners": patch
"@shipfox/api-triggers": patch
"@shipfox/api-workflows": patch
"@shipfox/node-drizzle": patch
---

Preserves full PostgreSQL timestamp precision in cursor pagination, so records are no longer skipped when their timestamps differ only at sub-millisecond precision.
