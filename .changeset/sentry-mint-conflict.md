---
"@shipfox/api-integration-sentry": patch
---

Sentry token renewal waits 15 seconds for a mint and repeats it when Sentry reports another mint in progress, instead of failing the tool call with `access-denied`.
