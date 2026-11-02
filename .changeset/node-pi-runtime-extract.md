---
"@shipfox/node-pi-runtime": minor
"@shipfox/api-agent": patch
---

New `@shipfox/node-pi-runtime` package builds a pi model from resolved runtime credentials, so a runner step and a server turn share one setup.

- **Package:** `createPiModel`, the in-memory credential store, custom provider registration, model resolution, managed stream recovery, and `AgentConfigError` moved here from the runner. Egress checks come in as a hook.
- **`@shipfox/api-agent`:** depends on the package and on `@earendil-works/pi-coding-agent`. Nothing loads either at startup.
