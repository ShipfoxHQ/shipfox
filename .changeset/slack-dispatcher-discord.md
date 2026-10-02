---
"@shipfox/workflow-templates": minor
---

Adds a Discord part to the `slack-dispatcher` template, so its `chat` role accepts `slack` or `discord`. A mention of the Shipfox bot in a listed Discord channel, or in a thread of one, starts the dispatcher. The routed workflows receive the `channel_id` and `message_id` of the mention, and every reply goes into the thread under it. The title is now "Route chat requests to your workflows", and the summary no longer names Slack. The template id is unchanged.
