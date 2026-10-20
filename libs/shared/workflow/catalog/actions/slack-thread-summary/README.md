# Slack thread summary

A Shipfox composite action that reads a Slack thread and summarizes it as decisions, open
questions, and next steps.

## What it does

The action runs two steps in the job of the step that uses it:

1. **Read the thread.** `shipfox/slack-thread-digest` writes every message of the thread to a Markdown file, with authors and permalinks.
2. **Summarize the thread.** An agent step reads that file with the prompt in
   [`prompts/summarize.md`](prompts/summarize.md) and writes the summary.

The summary has four sections: context, decisions, open questions, and next steps. Each
decision links to the message that made it. The action only reads from Slack. It never posts,
reacts, or edits.

## Installation and setup

Connect Slack to the workspace, and invite the Shipfox app to the channel that holds the
thread. Then reference the action by exact version in a workflow step, and bind its `slack`
alias to the Slack connection.

## Usage

```yaml
steps:
  - key: summary
    uses: shipfox/slack-thread-summary@1.0.0
    connections:
      slack: slack
    with:
      channel_id: ${{ event.channel }}
      thread_ts: '${{ has(event.thread_ts) ? event.thread_ts : event.ts }}'
```

Later steps read the summary at `${{ steps.summary.outputs.summary }}`. `complete` is `false`
when Slack counts more replies than the export holds.

## Behavior notes

- **The agent uses the workspace default model.** The action sets no `model`.
- **The thread is untrusted data.** The prompt tells the agent never to follow instructions
  that appear in messages.
- **The agent step reads the thread file only.** It needs no checkout of the repository.

## License

MIT
