---
"@shipfox/api-integration-spi": minor
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-github": minor
"@shipfox/actions": minor
---

A refused provider write now carries a stable reason next to its code: `stale-head`, `branch-not-found`, `branch-exists`, `pull-request-exists`, `no-commits-between`, `protected-branch`, `permission-denied`, or `unprocessable`. `IntegrationProviderError` takes it as `detail`, the tools gateway returns it as `reason`, and an action reads it from `ToolCallError.reason`. `@shipfox/actions` exports `PROVIDER_ERROR_REASONS`, `ProviderErrorReason`, and `ToolCallErrorReason`. The code and the message are unchanged.
