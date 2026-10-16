---
'@shipfox/api-integration-github': patch
'@shipfox/actions': patch
---

`pull_request_read.get_review_threads` now returns `isOutdated` on each thread, with `originalLine` and `originalStartLine`. GitHub sets `line` to null once a later push changes the code under a thread, so `originalLine` keeps the outdated thread's position.
