---
"@shipfox/api-workflows": patch
"@shipfox/runner-protocol": patch
"@shipfox/runner-orchestration": patch
---

A step that fails on a missing secret now names the secret.

- **API:** `secret-not-found` and `secret-input-missing` from the step secrets route carry `details: {key, store}`.
- **Runner:** the step failure reads "Secret `K` is not set in this project or workspace." or "Secret input `K` was not passed to this run." When the API sends no details, the runner keeps the generic message.
