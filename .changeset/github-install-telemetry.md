---
"@shipfox/api-integration-github-dto": minor
"@shipfox/api-integration-github": patch
---

Adds GitHub installation identity logging, callback outcome telemetry, and the `integrations_github_connect_total` counter with bounded `flow` and `outcome` labels. Extends the GitHub webhook payload schema with optional `installation.account.login`, `installation.account.type`, `sender.login`, and `requester.login` fields.
