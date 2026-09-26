# Ask the codebase in Slack

Answer questions about the project's repository in the Slack thread where someone asked them.

## Prerequisites

- Connect Slack with the Shipfox app, and invite the app to every channel where it answers.
- The project's GitHub source integration connection can read the repository.
- The runner has Bash and Git. The workflow needs no build setup, installation, or test command.

## Scope the workflow

The agent answers from the project's repository only. It reads the default branch through a read-only checkout without saved Git credentials.
The agent has no Slack, GitHub, or other integration tools. It cannot read other channels, other repositories, issue trackers, or documentation sites.

Replace `replace-with-channel-id` with the IDs of the channels where the app answers, such as `["C0ABC12345", "C0DEF67890"]`.
Use channel IDs, not names. The app ignores mentions everywhere else, even in channels it belongs to.
Mentions from other apps and bots are ignored, so another bot cannot start a run.

## Choose the options

### Entry point

Keep the marked trigger block for `mention`, or remove it for `dispatch_only`.

- `mention` answers every mention of the app in the listed channels. It also keeps the manual trigger.
- `dispatch_only` keeps only the manual trigger. Use it when a Slack dispatcher already handles mentions. Otherwise, one mention gets two replies.

### Manual inputs

A manual start, such as a dispatcher's `start_workflow_run` call, passes these inputs:

| Input | Required | Value |
| --- | --- | --- |
| `channel_id` | Yes | ID of the channel that holds the thread. |
| `thread_ts` | Yes | Timestamp of the thread's parent message. For a top-level message, use the message's own `ts`. |
| `request` | No | The question to answer. Without it, the agent answers the latest question addressed to the app in the thread. |

A run without `channel_id` or `thread_ts` fails before the agent starts and posts nothing.
Manual starts skip the channel list, so the starting workflow or person owns that check.
The `answer` job publishes `status` and `reply_ts`, the timestamp of the posted reply.

## Choose a model

Confirm the provider, model, harness, and thinking setting for `# model:answer`.
The step traces behavior across files and separates evidence from inference, so the template suggests a strong model with high thinking. The manifest has no tested model reference or scored suggestion.

## Outcomes

The agent chooses one status. Every status posts one reply in the thread.

| Status | Reply |
| --- | --- |
| `answered` | Answers with repository-relative file references. It separates what the agent read from what it inferred and names remaining uncertainty. |
| `needs_clarification` | Asks at most two specific questions and says what the agent checked. |
| `not_found` | Says what the agent searched and where the answer might live. It does not guess. |

Each reply ends with the repository and commit it was based on.
Replies are limited to 3,000 characters. The prompt tells the agent not to mention users, groups, or channels.

## Follow-up questions

The workflow posts one reply per run and does not listen for later messages.
To ask a follow-up, mention the app again in the same thread. The new run reads the whole thread, including earlier replies.

The workflow reads the thread's parent message and its first 49 replies, and keeps the first 1,000 characters of each.
The prompt still includes the full message that started the run. For a longer thread, the agent learns that messages are missing.
A thread can still exceed the 64 KiB step output limit, for example with many long non-Latin messages. That run fails before the agent starts and posts nothing.

## Expected writes and failures

Each run posts one message in the thread: the answer or a failure notice.
The workflow never changes the repository, and the checkout job saves no Git credentials.
Slack retries of the same event are recorded once, so they do not start a second run.
Two mentions in one thread start two runs, and each run answers its own message.

A failed answer job posts a short notice with the run number.
The workflow cannot post the notice when the app cannot read or write the channel. For example, the app might not be invited, or the manual inputs might be wrong.
Inspect the run in Shipfox before starting it again.

## Verify the workflow

Before relying on an adapted workflow, run it in an allowed test channel:

- Ask a question that the code answers, and check the cited paths.
- Ask an ambiguous question, and check that the reply asks for clarification.
- Ask about something outside the repository, such as a production setting, and check that the reply says so without guessing.
- Mention the app in a channel that is not listed, and check that no run starts.
