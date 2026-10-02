---
"@shipfox/workflow-templates": minor
---

Adds Discord as a `chat` provider of the `ask-codebase` template. A mention of the bot in an allowed channel, or in a thread of one, starts the run. The workflow reads the thread and replies in the thread of the mention, which Discord creates when the message has none.

The title and summary are now provider-neutral, and the workflow names its posted reply `message_id` internally while still publishing `reply_ts`. The guide covers the Discord channel IDs, manual inputs, and message limits.
