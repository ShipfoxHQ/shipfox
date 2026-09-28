---
"@shipfox/workflow-templates": minor
---

Adds the `slack-to-ticket` template. It drafts one Linear ticket from a Slack thread and the project's repository, then links the ticket in the thread. It starts from a mention in listed channels, or from a dispatcher with `channel_id`, `thread_ts`, and an optional `request`.

The agent reads the thread with the Slack `read_thread` tool and drafts from a read-only checkout without saved credentials. The ticket has problem, scope, acceptance criteria, relevant code, evidence, and open questions sections, with links to the thread and the checked-out commit. When an essential fact is missing, the workflow asks in the thread instead. A thread that already has the workflow's ticket link gets a reply that names the existing ticket, and no new ticket. Options add tickets to a Linear project and keep only the manual entry point.
