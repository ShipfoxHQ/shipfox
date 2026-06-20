---
"@shipfox/api-integration-gitea": patch
"@shipfox/api-integration-gitea-dto": patch
"@shipfox/api-integration-core": patch
---

Scaffold an empty `gitea` integration provider that mirrors the `github` package structure, ahead of any behavior.

- New `@shipfox/api-integration-gitea` + `@shipfox/api-integration-gitea-dto` packages: `createGiteaIntegrationProvider()` returns an empty provider (`{provider: 'gitea', displayName: 'Gitea', adapters: {}, routes: []}`), plus a `src/config.ts` documenting the self-hoster variables (`GITEA_BASE_URL`, `GITEA_SERVICE_USERNAME`, `GITEA_SERVICE_TOKEN`, `GITEA_WEBHOOK_SECRET`, `GITEA_WEBHOOK_TARGET_URL`, `GITEA_CHECKOUT_TTL_SECONDS`) and an empty provider database wired with the stable migrations table `__drizzle_migrations_integrations_gitea`.
- `@shipfox/api-integration-core`: register the Gitea provider behind `INTEGRATIONS_ENABLE_GITEA_PROVIDER` (default false). With the flag enabled, `gitea` appears in `GET /integration-providers`. Dormant scaffold; no runtime behavior yet.
