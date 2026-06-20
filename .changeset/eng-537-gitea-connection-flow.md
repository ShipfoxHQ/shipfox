---
"@shipfox/api-integration-gitea": patch
"@shipfox/api-integration-gitea-dto": patch
"@shipfox/api-integration-core": patch
---

Add the Gitea connection flow so a workspace member can link a Gitea org with a single authenticated request (no OAuth, no redirect).

- `@shipfox/api-integration-gitea-dto`: `createGiteaConnectionBodySchema` (`{workspace_id, org}`); the response reuses the shared `integrationConnectionDtoSchema`.
- `@shipfox/api-integration-gitea`: `POST /integrations/gitea/connections` (`AUTH_USER`, workspace membership) canonicalizes the org to lower case (Gitea routes org names case-insensitively, so this keeps the case-sensitive ownership lookup and unique indexes from being bypassed by a case variant), validates the org via the API, rejects an org already linked to another workspace (409), registers an org-level push webhook (`POST /orgs/{org}/hooks` with `GITEA_WEBHOOK_SECRET`/`GITEA_WEBHOOK_TARGET_URL`), and in one transaction upserts the core connection (`provider: 'gitea'`, `externalAccountId: org`) and a new `integrations_gitea_connections` row (`connection_id`/`org` unique, stored `webhook_id`). Re-connecting an already-active org is idempotent and skips a second webhook. Webhook registration itself is idempotent (an existing org hook for the target URL is reused) and compensated (a hook created before a transaction that then rolls back is deleted), so concurrent or retried connects do not leave orphaned hooks. The `GiteaApiClient` gains `organizationExists`, `createOrgPushWebhook`, and `deleteOrgWebhook`, and the provider exposes `connectionExternalUrl` pointing at the org on the Gitea instance.
- `@shipfox/api-integration-core`: wire the Gitea connect closure (`connectGiteaConnection`) and the cross-tenant lookup (`getExistingGiteaConnection`) into the provider, mirroring `connectGithubInstallation`.

Connecting an org creates an active connection visible in `GET /integration-connections` and registers a Gitea webhook whose id is stored.
