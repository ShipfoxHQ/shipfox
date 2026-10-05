---
'@shipfox/cloudflare-pages': minor
---

Retries the pull request lookup in `assertCurrentCommit` when the GitHub API call fails, and adds `attempts` and `retryDelayMs` options.
