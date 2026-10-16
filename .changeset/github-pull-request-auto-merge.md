---
'@shipfox/api-integration-github': minor
'@shipfox/actions': minor
---

Add the `pull_request_auto_merge` GitHub tool. `enable` makes GitHub merge a pull request once its required reviews and checks pass, with an optional merge method and commit title and message. When GitHub refuses auto-merge because nothing blocks the merge, `enable` merges the pull request right away and returns `pull_request.merged` as true. `enable` also succeeds on a pull request that is already merged, so a retry is safe. `disable` cancels a pending auto-merge and succeeds when none is enabled. `enable` is sensitive, like `merge_pull_request`, and `disable` needs only `pull_requests: write`. The generated tool types include the new tool.

Errors from GitHub GraphQL tools now carry a reason, as REST errors do. `FORBIDDEN` is `access-denied`, `RATE_LIMITED` is `rate-limited`, and any other refusal is `provider-rejected` with GitHub's messages. Before, only a missing review thread was classified, and other GraphQL errors were rethrown unclassified.
