---
"@shipfox/api-workflows-dto": minor
"@shipfox/api-integration-core": minor
"@shipfox/api-workflows": patch
---

The integration tool gateway serves action steps as well as agent steps.

- **Leased tool context:** `getLeasedAgentToolContext` keeps its name and accepts leased `action` steps. Other step types still fail with `leased-step-not-agent`. The result gains `stepType` (`agent` or `action`). For an action step, `integrations` holds the tools frozen at run creation, with one entry per connection, and each tool carries its `result` kind.
- **Audit:** the tool call caller adds `action`, on both the audit line and the `integrations_agent_tool_call` metric label. When the runner sends `x-shipfox-call-id`, the audit line records it as `callId`.
