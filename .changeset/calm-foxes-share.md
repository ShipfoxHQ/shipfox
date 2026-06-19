---
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-github": patch
"@shipfox/api-projects": patch
---

Moves source-event translation to the integration module: source-control providers emit a typed, provider-agnostic `INTEGRATION_SOURCE_COMMIT_PUSHED` event via one transactional publisher, projects subscribes to it instead of decoding GitHub payloads, and branch-deletion pushes are dropped at the source.
