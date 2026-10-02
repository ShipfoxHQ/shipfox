---
"@shipfox/workflow-templates": minor
---

Adds Discord as a chat provider of the `slack-to-ticket` template, now titled "Create a ticket from a chat conversation". A mention of the Shipfox bot in a listed channel or thread starts it, the agent reads the conversation with the Discord `read_thread` tool, and the workflow replies with the ticket link in the thread under the mention, starting one when there is none. A manual start takes `channel_id` and `message_id`, and the `ticket` job publishes the link message's ID as `reply_id`. The Slack variant keeps its behavior. Its ticket text and Linear link now say "chat conversation" instead of "Slack thread".
