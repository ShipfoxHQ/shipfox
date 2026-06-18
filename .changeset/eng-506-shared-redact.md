---
"@shipfox/redact": patch
"@shipfox/api-integration-core": patch
"@shipfox/api-integration-core-dto": patch
---

Add the `@shipfox/redact` package with shared credential-redaction helpers: `redactUrlCredentials` (scheme-agnostic free-text scrubber), `stripUrlCredentials` (structured single-URL stripper), `redactSecrets` (literal-secret scrubber), and the `REDACTION_PLACEHOLDER` constant. Move `redactCheckoutSpec` from `@shipfox/api-integration-core-dto` into `@shipfox/api-integration-core` so it can reuse the shared `stripUrlCredentials` without breaking the dto-only-dependency rule; its public export path (`@shipfox/api-integration-core`) is unchanged. No behavior change.
