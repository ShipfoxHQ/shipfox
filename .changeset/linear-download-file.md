---
"@shipfox/api-integration-linear": minor
"@shipfox/api-integration-core": patch
"@shipfox/actions": patch
---

Action steps can download Linear uploads with the `download_file` tool.

- **Tool:** `download_file` is a native `file` tool that takes `{url}`. The URL must start with `https://uploads.linear.app/`, or the tool fails with `file-location-not-allowed`. Signed URLs are accepted. The tool drops the signature and fetches with the connection's token.
- **Fetch:** every hop passes `@shipfox/node-egress-guard`. The tool follows up to 3 redirects, only to `https` locations, and drops the token once the origin changes. A file that announces more than 100 MiB fails with `file-too-large`.
- **Configuration:** `LINEAR_UPLOADS_URL` sets the uploads base URL, and `LINEAR_UPLOADS_ALLOW_PRIVATE_NETWORKS` lets a local test server stand in for it. Both default to the production behavior.
- **Types:** `ProviderToolCatalog` in `@shipfox/actions` lists `linear.download_file` with a `file` result.
