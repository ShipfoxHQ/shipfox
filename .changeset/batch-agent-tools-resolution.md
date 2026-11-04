---
"@shipfox/api-integration-core": minor
"@shipfox/api-workflows": patch
"@shipfox/api-integration-core-dto": minor
---

The new `resolveAgentToolsBatch` operation resolves the tool selections of several callers in one call. It loads the provider catalogs and workspace connections once and answers each request on its own, so a refused selection fails only its request. Run creation uses it in place of one `resolveAgentTools` call per agent step and action step.
