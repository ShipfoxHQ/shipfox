---
"@shipfox/workflow-templates": patch
---

Fixes the `slack-dispatcher` template failing its run when the workflow it starts replies in the thread itself. The follow-up job filled its pull request and question messages even when no pull request event had arrived, and the missing event failed the whole execution. Each message now renders empty when its event is missing.
