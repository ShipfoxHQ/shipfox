---
"@shipfox/api-integration-github": minor
"@shipfox/actions": minor
---

Add the `update_issue_comment` GitHub tool, which replaces the body of an issue or pull request conversation comment. A workflow can now keep one status comment up to date instead of posting a new one on every run. The tool edits only comments that the Shipfox GitHub app wrote, and refuses any other comment with `access-denied` before it sends the edit. The generated action tool types include the new tool.
