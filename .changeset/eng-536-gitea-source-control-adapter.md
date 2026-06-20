---
"@shipfox/api-integration-gitea": patch
---

Implement the Gitea API client and source-control adapter so the `gitea` provider can read repositories and mint checkout credentials.

- `GiteaApiClient`: calls `GITEA_BASE_URL` with service-account Basic auth to list org repositories, get a repository, resolve a ref to a commit sha, list a recursive tree, and read base64 file content. Gitea HTTP failures map to a `GiteaIntegrationProviderError` carrying a `reason` (`access-denied`, `repository-not-found`, `rate-limited` with `retryAfterSeconds`, `content-too-large`, `provider-unavailable`).
- `GiteaSourceControlProvider`: implements all five `SourceControlProvider` methods over the `gitea:<owner>/<repo>` external id scheme. `listFiles` filters the tree by prefix and rejects a truncated tree as `too-many-files`; `fetchFile` enforces `MAX_REPOSITORY_FILE_BYTES`; `createCheckoutSpec` returns a credential-free `${GITEA_BASE_URL}/{owner}/{repo}.git` URL with short-lived service credentials.
- `createGiteaIntegrationProvider()` now exposes the adapter at `adapters.source_control`.
