# Ask the codebase in chat

Answer questions about the project's repository in the Slack or Discord thread where someone asked them.

## Scope the workflow

The agent answers from the project's repository only. It reads the default branch through a read-only checkout without saved Git credentials.
The agent has no chat, GitHub, or other integration tools. It cannot read other channels, other repositories, issue trackers, or documentation sites.

Mentions from other apps and bots are ignored, so another bot cannot start a run.

Choose Slack or Discord as the `chat` provider. The two differ only in the trigger, the thread reads, the manual inputs, and where the reply goes.

## Choose the options

### Entry point

Keep the marked trigger block for `mention`, or remove it for `dispatch_only`.

- `mention` answers every mention of the app in the listed channels. It also keeps the manual trigger.
  Replace `replace-with-channel-id` with the IDs of the channels where the app answers.
  With Slack, such as `["C0ABC12345", "C0DEF67890"]`. With Discord, the IDs are snowflakes, such as `["1290000000000000001"]`. A mention in a Discord thread counts for the channel that holds the thread.
  The app ignores mentions everywhere else, even in channels it belongs to.
- `dispatch_only` keeps only the manual trigger. Use it when a chat dispatcher already handles mentions. Otherwise, one mention gets two replies.

### Manual inputs

A manual start, such as a dispatcher's `start_workflow_run` call, passes these inputs.

With Slack:

| Input | Required | Value |
| --- | --- | --- |
| `channel_id` | Yes | ID of the channel that holds the thread. |
| `thread_ts` | Yes | Timestamp of the thread's parent message. For a top-level message, use the message's own `ts`. |
| `request` | No | The question to answer. Without it, the agent answers the latest question addressed to the app in the thread. |

With Discord:

| Input | Required | Value |
| --- | --- | --- |
| `channel_id` | Yes | ID of the channel or thread that holds the message. |
| `message_id` | Yes | ID of the message to answer under. In a channel, the reply goes in that message's thread, which the workflow creates when it has none. In a thread, the tools ignore it and the reply goes in the thread, but the input is still required. |
| `request` | No | The question to answer. Without it, the agent answers the latest question addressed to the app in the thread. |

A run without the required inputs fails before the agent starts and posts nothing.
Manual starts skip the channel list, so the starting workflow or person owns that check.
The `answer` job publishes `status` and `reply_ts`, the timestamp of the posted Slack reply or the ID of the first posted Discord message.

## Choose a model

Confirm the provider, model, harness, and thinking setting for `# model:answer`.
The step traces behavior across files and separates evidence from inference, so the template uses a strong model with high thinking.

## Outcomes

The agent chooses one status. Every status posts one reply in the thread.

| Status | Reply |
| --- | --- |
| `answered` | Answers with repository-relative file references. It separates what the agent read from what it inferred and names remaining uncertainty. |
| `needs_clarification` | Asks at most two specific questions and says what the agent checked. |
| `not_found` | Says what the agent searched and where the answer might live. It does not guess. |

Each reply ends with the repository and commit it was based on.
Replies are limited to 3,000 characters. The prompt tells the agent not to mention users, groups, roles, or channels.
Discord limits a message to 2,000 characters, so a long reply goes out as two messages in the same thread.

## Follow-up questions

The workflow posts one reply per run and does not listen for later messages.
To ask a follow-up, mention the app again in the same thread. The new run reads the whole thread, including earlier replies.

With Slack, the workflow reads the thread's parent message and its first 49 replies, and keeps the first 1,000 characters of each.
With Discord, it reads the message the thread started from and the 50 most recent messages of the thread, and keeps the first 1,000 characters of each.
In Discord, the agent learns that messages may be missing when the read returns 50 or more messages.
The prompt still includes the full message that started the run. For a longer thread, the agent learns that messages are missing.
A thread can still exceed the 64 KiB step output limit, for example with many long non-Latin messages. That run fails before the agent starts and posts nothing.

## Behavior and failures

The workflow never changes the repository, and the checkout job saves no Git credentials.
Slack and Discord retries of the same event are recorded once, so they do not start a second run.
Two mentions in one thread start two runs, and each run answers its own message.

A failed answer job posts a short notice with the run number.
The workflow cannot post the notice when the app cannot read or write the channel. For example, the Slack app might not be invited, the Discord bot might lack permission to view the channel or create threads, or the manual inputs might be wrong.
Inspect the run in Shipfox before starting it again.

## Verify the workflow

Before relying on an adapted workflow, run it in an allowed test channel:

- Ask a question that the code answers, and check the cited paths.
- Ask an ambiguous question, and check that the reply asks for clarification.
- Ask about something outside the repository, such as a production setting, and check that the reply says so without guessing.
- Mention the app in a channel that is not listed, and check that no run starts.
