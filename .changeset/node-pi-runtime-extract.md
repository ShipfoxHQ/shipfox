---
"@shipfox/node-pi-runtime": minor
"@shipfox/api-agent": patch
---

New `@shipfox/node-pi-runtime` package builds a pi model from resolved runtime credentials.

- **Package:** `createPiModel` builds a pi model from resolved runtime credentials. It comes with an in-memory credential store, custom provider registration, model resolution, managed stream recovery, and `AgentConfigError` for user-fixable configuration failures. The caller supplies the egress policy.
- **`@shipfox/api-agent`:** depends on the package and on `@earendil-works/pi-coding-agent`. Nothing loads either at startup.
