---
"@shipfox/api-integration-core-dto": patch
"@shipfox/api-integration-core": patch
"@shipfox/api-integration-github": patch
"@shipfox/api-integration-debug": patch
---

Add `createCheckoutSpec()` to the integration source-control service and the GitHub and Debug providers. GitHub mints a short-lived, repo-scoped installation access token and returns it as structured `CheckoutCredentials` alongside a clean `repositoryUrl` (the secret is never embedded in the URL); Debug returns its static clone URL with no credentials. `ref` defaults to the repository default branch, providers without checkout support raise a typed `IntegrationCheckoutUnsupportedError`, and a `redactCheckoutSpec()` helper masks the token for logging. Dormant until the checkout-token endpoint and runner enrichment are wired in; no runtime behavior changes yet.
