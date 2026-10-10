---
"@shipfox/api-integration-jira": patch
---

Jira tool calls now report `not-found` for HTTP 404 responses and `provider-rejected` for HTTP 400 responses instead of `unknown`, so a workflow gate can tell a missing issue from an invalid request.
