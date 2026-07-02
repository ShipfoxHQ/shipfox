---
"@shipfox/client-secrets": minor
"@shipfox/client-workspace-settings": minor
"@shipfox/api-secrets": patch
"@shipfox/api-secrets-dto": patch
"@shipfox/client-router": patch
---

Add the Secrets & Variables workspace settings UI (S1b).

- New `@shipfox/client-secrets` package: transport + React Query hooks (a shared
  `createStoreApi` factory), a write-only secret form and a readable variable form
  (TanStack Form + Zod, multiline `Textarea` values, live short-value / sensitive-name
  advisories), and the workspace secrets/variables sections (single-call list, masked
  secret values, copy-name, delete with blast-radius warning).
- `@shipfox/client-workspace-settings`: new Secrets and Variables settings pages and nav
  entries.
- `@shipfox/api-secrets-dto`: export `SECRETS_MAX_LIST_LIMIT` and raise the list `limit`
  cap so the settings UI can fetch the whole bounded set in one request; the variable
  list item now carries `value_truncated`.
- `@shipfox/api-secrets`: the variable list returns a bounded single-line preview of each
  value (the full value is read via `GET /variables/:key` when editing) so a single-call
  list cannot materialize very large responses; startup fails if `SECRETS_MAX_PER_WORKSPACE`
  exceeds the list limit.
- `@shipfox/client-router`: register the `/workspaces/$wid/settings/secrets` and
  `/variables` routes.
