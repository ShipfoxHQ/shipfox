---
"@shipfox/workflow-document": patch
"@shipfox/api-definitions": patch
"@shipfox/api-workflows": patch
"@shipfox/api-workflows-dto": patch
"@shipfox/runner-agent": patch
---

Let an agent workflow step pick its pi provider with an optional free-text `provider` field (default `anthropic`), threaded to the runner's pi model lookup, and split agent-step failures into a user-fixable `agent_config_invalid` reason (unknown provider, missing runner credentials, wrong provider/model pair) versus `agent_invocation_failed` for genuine provider/API errors.
