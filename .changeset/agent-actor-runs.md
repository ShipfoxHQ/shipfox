---
"@shipfox/api-triggers": minor
"@shipfox/api-triggers-dto": minor
"@shipfox/api-agent": minor
"@shipfox/api-agent-dto": minor
"@shipfox/api-integration-core": patch
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-integration-spi": minor
"@shipfox/api-integration-shipfox": minor
"@shipfox/client-workflows": patch
---

An agent in a Slack or Linear conversation starts workflow runs. `fireManualTrigger` accepts a conversation with a provider and no user as an agent actor, and `start_workflow_run` no longer needs a Shipfox user for such a conversation. The run budget still applies. The run page reads "Started by Shippy in Slack", and Linear shows the run link on the agent session. Web conversations still record their author.
