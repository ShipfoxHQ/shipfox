# Report failed Shipfox workflow runs

Post a Slack or Discord report when a workflow run fails, independent of the workflow that failed.

## How the report works

The workflow starts on the Shipfox `run.completed` event, which every run attempt sends when it ends.
Each failed run attempt starts one report run and posts one message, usually within seconds.
A rerun that fails again is reported again with its attempt number.

The report reads the failed run, names its failed jobs and steps, shows the first step error and the last 15 lines of the first failed log, and suggests a next step.
A run that failed before any job started is reported too. The report says no job started.

After the report posts, the `diagnose` job has an agent read the run and its failed logs.
It replies in the report's thread with the error line, a likely cause, and one fix to try.
On Discord, the reply starts a public thread on the report message. A reply over 2,000 characters is split into up to 5 messages, and one over 10,000 characters is cut.
The agent gets only the read tools `get_workflow_run` and `get_step_logs`.
The `diagnose` job always succeeds. A failed diagnosis loses only the thread reply.

Dev runs are never reported. Neither are this workflow's own runs, so a failed report never reports itself.

## Choose the options

### Scope

Every project in the workspace sends `run.completed`, so the trigger filter decides which runs to report.

`project` keeps the marked `event.project.id` line. Replace `replace-with-project-id` with the ID of the project that holds this workflow, from `list_projects`.
`workspace` removes that line and reports every project into one channel. Add this workflow to one project only, or each failure is reported once per copy.

### Workflows

`all` reports every synced workflow. `selected` keeps the marked `event.workflow.path in [...]` line.
Replace `.shipfox/workflows/replace-with-workflow.yml` with the exact workflow file paths, such as `[".shipfox/workflows/deploy.yml"]`.

## Bind the connection and channel

Replace `slack_notify` with the Slack connection slug in every `connection` line of the Slack steps.
Replace `replace-with-slack-channel-id` with the report channel ID.

With Discord, replace `discord_notify` with the Discord connection slug in every `connection` line of the Discord steps.
Replace `replace-with-discord-channel-id` with the report channel ID, which Discord shows when Developer Mode is on.
The bot needs permission to view the channel, send messages, and create public threads there.
Keep every `connection: shipfox` line and `source: shipfox`. They use the built-in Shipfox connection, not a workspace connection.

Report links point to `https://app.shipfox.io/runs/`. On a self-hosted installation, replace `https://app.shipfox.io` with the address of your Shipfox app.

## Choose a model

Confirm the provider, model, harness, and thinking setting for `# model:diagnose`.
The manifest has no tested model reference or scored suggestion.
The step reads logs and summarizes them, so a small model is usually enough.

## Behavior and failures

Each diagnosis uses model inference.
A burst of failures posts one message per failed run.
The workflow never reruns, cancels, or changes a run.

If Slack or Discord rejects the message, for example because the channel was archived or the bot lost access, the report run fails and nothing is retried.
Fix the cause, then rerun the failed report run from Shipfox to post it.

## Validate the workflow

Validate the shape with a dry run against the `run_completed` trigger.
Shipfox keeps a `run.completed` event only while a synced workflow subscribes to it, so a new workspace has none to replay.
If `list_trigger_events` finds a retained `run.completed` event for a failed, synced run in the chosen project that matches the selected workflow filter and is not this workflow's own run, replay it in a dev run.
Otherwise report "shape validated, not executed", merge the workflow, then fail a run on purpose, such as a manual workflow whose step runs `exit 1`.
Before any run, tell the user that it posts to the chosen channel.

Check these cases before relying on the workflow:

- A run that fails in a step: the report names the job and step and shows the log excerpt, and the diagnosis replies in its thread.
- A run that succeeds, and a dev run that fails: no report.
- A run of another project: reported only with `workspace` scope.
- A failed report run, for example with an archived channel: rerunning it posts the report.
