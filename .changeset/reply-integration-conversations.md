---
"@shipfox/api-agent": minor
---

Sends the outcome of each turn in a Slack or Linear conversation back through the provider. A turn's answer goes out as a `response`, and a failed or denied turn goes out as an `error`. A turn with no text sends nothing, and a repeated delivery sends the reply once. Every turn ends by clearing the provider's progress, and each tool call is shown as `working` with the tool's name. A `stop` interaction asks the running turn to stop, and the stopped turn sends its partial text, or "Stopped.". An undeliverable reply is recorded as a `turn_notice` and counted in `agent_conversation_replies`, with no retry. Agent adds the `deliverReply` activity and the `agent_reply_deliveries` table.
