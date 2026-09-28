# Create a ticket from a Slack conversation

Turn a request in a Slack thread into one Linear ticket grounded in the project's repository. The workflow links the ticket in the thread.

## Prerequisites

- Connect Slack with the Shipfox app, and invite the app to every channel where it creates tickets.
- Connect Linear. The integration connection needs write access to the team that owns new tickets.
- The project's GitHub source integration connection can read the repository.
- The runner has Bash and Git. The workflow needs no build setup, installation, or test command.

## Scope the workflow

The agent drafts from the Slack thread and the project's repository only. It reads the default branch through a read-only checkout without saved Git credentials.
The agent reads the thread itself with the Slack `read_thread` tool. It sees every message in full, including pasted logs and stack traces. It has no other integration tools and cannot write anywhere.
Tool steps outside the agent create the ticket and post in the thread.

Shipfox cannot limit `read_thread` to one thread. The prompt tells the agent to read only the thread that started the run. A message in that thread could still ask it to read another one.
The agent can read threads in any channel the app belongs to, and what it reads can reach the ticket and the reply. Invite the app only to channels whose content can appear in your tickets.

Replace `replace-with-channel-id` with the IDs of the channels where the app creates tickets, such as `["C0ABC12345", "C0DEF67890"]`.
Use channel IDs, not names. The app ignores mentions everywhere else, even in channels it belongs to.
Mentions from other apps and bots are ignored, so another bot cannot start a run.

Do not list a channel in this workflow and in another workflow that answers mentions, such as the codebase question template. Both would reply to one mention. Use a Slack dispatcher to route mentions in shared channels.

Replace `replace-with-team-key` with the key of the Linear team that owns new tickets, such as `ENG`.

## Choose the options

### Entry point

Keep the marked trigger block for `mention`, or remove it for `dispatch_only`.

- `mention` creates a ticket for every mention of the app in the listed channels. It also keeps the manual trigger.
- `dispatch_only` keeps only the manual trigger. Use it when a Slack dispatcher already handles mentions.

### Linear project

Keep the marked `project` line for `project`, or remove it for `team_only`.

- `team_only` creates tickets in the team without a project.
- `project` also adds every ticket to one project. Replace `replace-with-project` with the project's name or ID.

### Manual inputs

A manual start, such as a dispatcher's `start_workflow_run` call, passes these inputs:

| Input | Required | Value |
| --- | --- | --- |
| `channel_id` | Yes | ID of the channel that holds the thread. |
| `thread_ts` | Yes | Timestamp of the thread's parent message. For a top-level message, use the message's own `ts`. |
| `request` | No | What the ticket should track. Without it, the agent drafts from the latest request addressed to the app in the thread. |

A manual start without `channel_id` or `thread_ts` fails before it reads the thread and posts nothing.
Manual starts skip the channel list, so the starting workflow or person owns that check.
The `ticket` job publishes `ticket`, `ticket_url`, and `reply_ts`, the timestamp of the link message.

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
Code links point to the checked-out commit. The ticket ends with links to the Slack thread and the commit, and it has the thread as a Linear link attachment.
The agent records only what the thread states or the code shows. Disagreements and missing decisions become open questions, not requirements.

After the agent asks questions, answer them in the thread and mention the app again. The new run reads the whole thread.

## Expected writes and failures

Each run makes at most these writes:

- One Linear ticket in the configured team, and project when chosen. The workflow never updates or closes tickets.
- One message in the thread: the ticket link, the questions, the existing ticket's identifier, or a failure notice.

The workflow never changes the repository, and the checkout saves no Git credentials.
The workflow does not copy thread messages into step or job outputs. The agent's session transcript holds what it read.

A failed draft or ticket job posts a short notice with the run number.
The workflow cannot post the notice when the app cannot read or write the channel. For example, the app might not be invited, or the manual inputs might be wrong.
Inspect the run in Shipfox before starting it again.

## Duplicate tickets

A thread gets at most one ticket from this workflow:

- Slack retries of the same event are recorded once, so they do not start a second run.
- The agent looks for the workflow's link message, which starts with `Ticket <identifier> tracks this thread`. When the app posted one, the run replies with that identifier and creates nothing.

The agent makes this check, so a duplicate request still costs one agent run.
Two requests in one thread that start before either run posts its link can each create a ticket.
When the ticket is created but the link message fails, a later run cannot find the ticket. Check Linear before you start the workflow again for that thread.

## Thread content

The agent reads message text only. It cannot open files uploaded to the thread, such as log files or screenshots. Paste the relevant lines as text instead.

## Verify the workflow

Before relying on an adapted workflow, run it in an allowed test channel and a test Linear team:

- Discuss a small code change, ask the app for a ticket, and check the ticket's sections, code links, and thread link.
- Ask for a ticket without saying what should change, and check that the app asks questions and creates nothing.
- Mention the app again in the thread that already has a ticket, and check that it links the existing ticket and creates nothing.
- Mention the app in a channel that is not listed, and check that no run starts.
