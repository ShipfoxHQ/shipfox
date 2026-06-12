# @shipfox/api-integration-debug

## 0.0.1

### Patch Changes

- f3614ae: Add `createCheckoutSpec()` to the integration source-control service and the GitHub and Debug providers. GitHub mints a short-lived, repo-scoped installation access token and returns it as structured `CheckoutCredentials` alongside a clean `repositoryUrl` (the secret is never embedded in the URL); Debug returns its static clone URL with no credentials. `ref` defaults to the repository default branch, providers without checkout support raise a typed `IntegrationCheckoutUnsupportedError`, and a `redactCheckoutSpec()` helper masks the token for logging. Dormant until the checkout-token endpoint and runner enrichment are wired in; no runtime behavior changes yet.
- Updated dependencies [c0a883c]
- Updated dependencies [e47f8da]
- Updated dependencies [f3614ae]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/api-integration-core-dto@0.1.0
  - @shipfox/api-workspaces@0.0.1
