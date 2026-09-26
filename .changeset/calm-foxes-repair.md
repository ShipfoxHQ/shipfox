---
"@shipfox/workflow-templates": minor
---

Updates the dependency CI repair template to revision 2.

Scopes runs to one repository and bot-authored PR, serializes repairs, and skips stale failures. Installation errors now reach the repair agent, and validation repeats installation after edits.

Adds explicit no-change and human-help outcomes, tested patches for comment-only delivery, and result or failure comments. Pushes check the current PR head and preserve the intended upgrade. The guide explains credential access, auto-merge, commit rules, and local validation limits.
