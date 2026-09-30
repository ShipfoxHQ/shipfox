# Slack thread digest

A Shipfox workflow action that saves a Slack thread to a Markdown file, with authors and links.

## What it does

The action reads every message of one Slack thread through the step's Slack connection. It then
writes the thread to a Markdown file in the job workspace. A later step, such as an agent, reads
the file instead of calling Slack itself.

- **Every message, once, in order.** The action follows every page of the thread. It removes
  replies that appear on two pages and sorts the messages by timestamp.
- **Authors by name.** Each Slack user is looked up once. The message shows the display name,
  then the real name, then the user ID when the lookup fails.
- **Links back to Slack.** Each message links to its permalink, and each attached file links
  to its Slack page.
- **A completeness flag.** The `complete` output is `false` when Slack counts more replies than
  the export holds. The file says so in its first lines.

The action only reads from Slack. It never posts, reacts, or edits.

## Installation and setup

Connect Slack to the workspace, and invite the Shipfox app to the channel that holds the
thread. Then reference the action by exact version in a workflow step.

## Usage

```yaml
steps:
  - key: digest
    uses: shipfox/slack-thread-digest@1.0.0
    connections:
      slack: slack
    with:
      channel_id: ${{ event.channel }}
      thread_ts: '${{ has(event.thread_ts) ? event.thread_ts : event.ts }}'
```

Later steps read the file at `${{ steps.digest.outputs.path }}`, which defaults to
`context/slack-thread.md`. Set `destination` to write it elsewhere.

The file looks like this:

```md
# Slack thread C0123 1721300000.000100

Retrieved 2026-09-29T10:00:00.000Z. Complete: 2 messages, the parent and 1 reply.

---

## Ada, 2024-07-18T10:53:20Z

[ts 1721300000.000100](https://acme.slack.com/archives/C0123/p1721300000000100)

The deploy failed on staging.

---

## Grace, 2024-07-18T10:55:00Z

[ts 1721300100.000100](https://acme.slack.com/archives/C0123/p1721300100000100?thread_ts=1721300000.000100)

Rolling back now.

File: [rollback.log](https://acme.slack.com/files/U2/F1/rollback.log)
```

## Behavior notes

- **The file appears only once it is whole.** The action writes a temporary file and renames
  it, so a failed step never leaves a file that looks complete.
- **A failed thread read fails the step.** A failed author or permalink lookup only logs a
  warning, and the message keeps the user ID or the bare timestamp.
- **The destination is relative to the step working directory.** Missing directories are
  created, and an existing file is replaced.
- **Message text keeps Slack's markup,** such as `<@U123>` mentions and `<url|label>` links.
  Surrounding whitespace is trimmed, and a message without text shows `_No text._`.

## Development

```sh
turbo check --filter=@shipfox/action-slack-thread-digest
turbo type --filter=@shipfox/action-slack-thread-digest
turbo test --filter=@shipfox/action-slack-thread-digest
```

Tests run the action with fake Slack tools through `@shipfox/actions/testing`. The registry
release tool builds and publishes it; see `tools/registry-release`.

## License

MIT
