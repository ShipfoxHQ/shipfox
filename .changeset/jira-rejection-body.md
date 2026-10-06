---
"@shipfox/api-integration-jira": patch
---

Fixes Jira tool calls that failed with `provider-unavailable` on HTTP 400 and 404 responses. The client read the response body a second time after the HTTP library had consumed it. It now returns the error body Jira sent, so a missing issue or an invalid JQL query reaches the agent as a result instead of retrying like an outage.
