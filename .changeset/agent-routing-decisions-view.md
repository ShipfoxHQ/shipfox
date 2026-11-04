---
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-agent-access": minor
"@shipfox/client-triggers": minor
---

Event routing shows which agent answered a Slack or Linear request, and when agent rules overlapped.

- **Event detail:** an "Agent routing" panel lists `agent` decisions with the agent and its project: the owner, the default agent, each `ambiguous` match with the agent that answered instead, and a dropped interaction with its reason. An event that only an agent took reads "Sent to an agent" instead of "Triggered 0 workflows".
- **Tools:** each `get_trigger_event` decision has a new `agent_key`, the agent of an `agent` decision, or null. The tool description explains each agent outcome.
