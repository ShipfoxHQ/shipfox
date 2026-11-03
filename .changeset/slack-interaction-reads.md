---
'@shipfox/api-integration-slack': minor
---

Reads Slack for agents. Slack now offers the interaction capability: a channel mention and a message in the agent view or a direct message are requests, a reply in a channel thread is a follow-up, and the agent view's stop control is a stop. Each carries the surface, channel, user, and team as context, and agent view messages also carry the viewed channel when Slack supplies it. Messages from apps and Slack Connect users never reach an agent.
