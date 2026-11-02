---
"@shipfox/api-definitions-dto": minor
"@shipfox/api-triggers-dto": minor
"@shipfox/api-definitions": patch
"@shipfox/api-triggers": patch
"@shipfox/api-agent-access": patch
"@shipfox/client-workflows": minor
---

Explains why a run from a branch fails when the integration connection for the project source isn't active. `POST /dev-runs` and the `create_dev_run` tool now return `integration-connection-inactive`. The client copy links to the integrations settings instead of saying "Try again in a moment".
