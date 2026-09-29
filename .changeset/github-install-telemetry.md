---
"@shipfox/api-integration-github-dto": minor
"@shipfox/api-integration-github": patch
---

Adds GitHub installation identity logging and install callback outcome telemetry, and records install callback outcomes on the `integrations_github_connect` counter. Extends the GitHub webhook payload schema with nullable `installation.account.login`, `installation.account.type`, `sender.login`, and `requester.login` fields.
