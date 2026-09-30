---
"@shipfox/workflow-templates": patch
---

Fixes shipped templates so the server accepts their workflow definitions. `ticket-to-pr` lets the reply step post and resolve review threads, and reads GitHub issue labels and Jira descriptions in forms the server accepts. `fix-dependency-ci` and `fix-default-branch-ci` now evaluate their event conditions correctly.
