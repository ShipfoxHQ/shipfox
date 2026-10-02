# Create a ticket from a chat conversation

Turn a request in a Slack thread or a Discord conversation into one Linear ticket grounded in the project's repository. The workflow links the ticket in the thread.

## Scope the workflow

The agent drafts from the chat conversation and the project's repository only. It reads the default branch through a read-only checkout without saved Git credentials.
The agent reads the thread itself with the chat provider's `read_thread` tool. It sees every message in full, including pasted logs and stack traces. It has no other integration tools and cannot write anywhere.
Tool steps outside the agent create the ticket and post in the thread.

Shipfox cannot limit `read_thread` to one thread. The prompt tells the agent to read only the thread that started the run. A message in that thread could still ask it to read another one.
The agent can read threads in any channel the app or bot can see, and what it reads can reach the ticket and the reply. With Slack, invite the app only to channels whose content can appear in your tickets. With Discord, give the bot access only to those channels.

Mentions from other apps and bots are ignored, so another bot cannot start a run.

Do not list a channel in this workflow and in another workflow that answers mentions, such as the codebase question template. Both would reply to one mention. Use a chat dispatcher to route mentions in shared channels.

Replace `replace-with-team-key` with the key of the Linear team that owns new tickets, such as `ENG`.

## Choose the options

### Entry point

Keep the marked trigger block for `mention`, or remove it for `dispatch_only`.

- `mention` creates a ticket for every mention of the app in the listed channels. It also keeps the manual trigger.
  Replace `replace-with-channel-id` with the IDs of the channels where the app creates tickets. A Slack list looks like `["C0ABC12345", "C0DEF67890"]`. A Discord list holds channel IDs, such as `["1290000000000000001"]`, and a thread counts as its parent channel.
  The app ignores mentions everywhere else, even in channels it belongs to.
  On Discord, a mention of the bot or of its managed role starts the workflow.
- `dispatch_only` keeps only the manual trigger. Use it when a chat dispatcher already handles mentions.

### Linear project

Keep the marked `project` line for `project`, or remove it for `team_only`.

- `team_only` creates tickets in the team without a project.
- `project` also adds every ticket to one project. Replace `replace-with-project` with the project's name or ID.

### Manual inputs

A manual start, such as a dispatcher's `start_workflow_run` call, passes these inputs. They depend on the chat provider.

With Slack:

| Input | Required | Value |
| --- | --- | --- |
| `channel_id` | Yes | ID of the channel that holds the thread. |
| `thread_ts` | Yes | Timestamp of the thread's parent message. For a top-level message, use the message's own `ts`. |
| `request` | No | What the ticket should track. Without it, the agent drafts from the latest request addressed to the app in the thread. |

With Discord:

| Input | Required | Value |
| --- | --- | --- |
| `channel_id` | Yes | ID of the channel or thread that holds the conversation. |
| `message_id` | Yes | ID of the message that started the conversation, or of the mention that asks for the ticket. The workflow replies in that message's thread. |
| `request` | No | What the ticket should track. Without it, the agent drafts from the latest request addressed to the bot in the conversation. |

A manual start without the required inputs fails before it reads the thread and posts nothing.
Manual starts skip the channel list, so the starting workflow or person owns that check.
The `ticket` job publishes `ticket` and `ticket_url`. It also publishes the link message's ID: `reply_ts`, its timestamp, with Slack, and `reply_id` with Discord.

## Choose a model

Confirm the provider, model, harness, and thinking setting for `# model:draft`.
The step reads a conversation and the code it concerns, then separates what people said from what they agreed. The template uses a strong model with high thinking.

## Outcomes

| Outcome | Writes |
| --- | --- |
| The thread asks for a clear change. | Creates one Linear ticket and posts its link in the thread. |
| An essential fact is missing. | Posts at most three questions in the thread. Creates no ticket. |
| An earlier run already linked a ticket in the thread. | Posts the existing ticket's identifier in the thread. Creates no ticket. |

The ticket has these sections: Problem, Scope, Acceptance criteria, Proposed approach, Relevant code, Evidence, and Open questions.
Proposed approach appears only when the code justifies one, and Evidence only when the thread has logs or errors.
Code links point to the checked-out commit. The ticket ends with links to the chat conversation and the commit, and it has the conversation as a Linear link attachment.
The agent records only what the thread states or the code shows. Disagreements and missing decisions become open questions, not requirements.

After the agent asks questions, answer them in the thread and mention the app again. The new run reads the whole thread.

## Behavior and failures

The workflow never updates or closes tickets.
The workflow never changes the repository, and the checkout saves no Git credentials.
The workflow does not copy thread messages into step or job outputs. The agent's session transcript holds what it read.

A failed draft or ticket job posts a short notice with the run number.
The workflow cannot post the notice when the app cannot read or write the channel. For example, the app might not be invited or might lack a Discord channel permission, or the manual inputs might be wrong.
Inspect the run in Shipfox before starting it again.

## Duplicate tickets

A thread gets at most one ticket from this workflow:

- Slack retries of the same event are recorded once, so they do not start a second run. Discord Gateway replays and duplicate sessions publish each message once, so they do not either.
- The agent looks for the workflow's link message, which starts with `Ticket <identifier> tracks this thread`. When the app posted one, the run replies with that identifier and creates nothing.

The agent makes this check, so a duplicate request still costs one agent run.
Two requests in one thread that start before either run posts its link can each create a ticket.
When the ticket is created but the link message fails, a later run cannot find the ticket. Check Linear before you start the workflow again for that thread.

## Thread content

The agent reads message text only. It cannot open files uploaded to the thread, such as log files or screenshots. Paste the relevant lines as text instead.

## Discord threads

A Discord mention at the top level of a channel starts a public thread on that message, and the workflow's replies go there. A mention inside a thread gets replies in the same thread.
The bot needs View Channel, Read Message History, Send Messages, and Create Public Threads in each listed channel.
Discord limits a message to 2,000 characters, and `send_message` splits longer replies. Ticket links carry no preview.
The agent reads the latest 100 messages of a thread. In a longer thread, it drafts from those.

## Verify the workflow

Before relying on an adapted workflow, run it in an allowed test channel and a test Linear team:

- Discuss a small code change, ask the app for a ticket, and check the ticket's sections, code links, and conversation link.
- Ask for a ticket without saying what should change, and check that the app asks questions and creates nothing.
- Mention the app again in the thread that already has a ticket, and check that it links the existing ticket and creates nothing.
- Mention the app in a channel that is not listed, and check that no run starts.
- With Discord, mention the bot at the top level of a listed channel and in an existing thread, and check that each reply lands in a thread.
