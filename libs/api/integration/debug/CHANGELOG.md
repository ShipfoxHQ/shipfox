# @shipfox/api-integration-debug

## 0.0.1

### Patch Changes

- fd83878: Debug integration: on each API startup (when the debug provider is enabled), emit an `INTEGRATION_SOURCE_COMMIT_PUSHED` for the debug `platform` repo on its main branch, for every active debug connection. This forces a re-sync of the debug workflow definitions on every boot. Only the typed event is emitted (not the generic `INTEGRATION_EVENT_RECEIVED` envelope), so it never re-runs `on_push` workflows.
- f3614ae: Add `createCheckoutSpec()` to the integration source-control service and the GitHub and Debug providers. GitHub mints a short-lived, repo-scoped installation access token and returns it as structured `CheckoutCredentials` alongside a clean `repositoryUrl` (the secret is never embedded in the URL); Debug returns its static clone URL with no credentials. `ref` defaults to the repository default branch, providers without checkout support raise a typed `IntegrationCheckoutUnsupportedError`, and a `redactCheckoutSpec()` helper masks the token for logging. Dormant until the checkout-token endpoint and runner enrichment are wired in; no runtime behavior changes yet.
- Updated dependencies [34ba284]
- Updated dependencies [b9c3f32]
- Updated dependencies [d02c5fd]
- Updated dependencies [a81b68c]
- Updated dependencies [115655e]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [e47f8da]
- Updated dependencies [f3614ae]
- Updated dependencies [f92122b]
- Updated dependencies [f8f339a]
- Updated dependencies [857fd73]
- Updated dependencies [b8e49ff]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [6181819]
  - @shipfox/node-fastify@0.2.0
  - @shipfox/api-workspaces@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/api-integration-core-dto@0.1.0
  - @shipfox/api-integration-debug-dto@0.0.0
