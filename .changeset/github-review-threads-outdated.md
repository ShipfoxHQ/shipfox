---
'@shipfox/api-integration-github': patch
'@shipfox/actions': patch
'@shipfox/workflow-templates': patch
---

`pull_request_read.get_review_threads` now returns `isOutdated` on each thread, and `originalLine` and `originalStartLine` on each thread and comment. GitHub sets `line` and `startLine` to null once a later push changes the code under a thread, so the original fields keep an outdated thread's position. The ticket-to-pr feedback loop now passes each review comment's `original_line` and tells the agent to check an outdated thread against the current code before applying it.
