---
"@shipfox/api-integration-jira": patch
---

Fixes Jira tool calls that failed with `provider-unavailable` on HTTP 400 and 404 responses. A missing issue or an invalid JQL query now reaches the agent with Jira's error body instead of being retried like an outage.
