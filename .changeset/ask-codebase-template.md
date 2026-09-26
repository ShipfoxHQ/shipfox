---
"@shipfox/workflow-templates": minor
---

Adds the `ask-codebase` template. It answers repository questions in the Slack thread where someone mentions the app, or when a dispatcher starts it with `channel_id`, `thread_ts`, and an optional `request`.

The workflow reads the thread with a tool step and answers from a read-only checkout without saved credentials. Its agent has no integration tools. It posts one reply with file references and the source commit, or a failure notice. The guide covers channel scope, the manual-only option for dispatchers, outcomes, and expected writes.
