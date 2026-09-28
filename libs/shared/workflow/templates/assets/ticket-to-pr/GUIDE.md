# Task to pull request

Use this template when a task should produce a tested GitHub pull request. A task comes from a Linear, Jira, or ClickUp ticket, or from a manual start with explicit task inputs. A Slack dispatcher, a ticket loader, or a person can start it.

## Prerequisites

- Connect GitHub as the project's source.
- Give the GitHub connection permission to read and write repository contents and pull requests.
- Use GitHub Actions for the feedback loop, which is on by default.
- For the optional tracker, connect Linear, Jira, or ClickUp.
- For ClickUp, connect it as a dedicated service account. Give that account access to every Space, Folder, and List the workflow monitors. ClickUp sends events and serves tasks only from locations the account can see.

## Choose a tracker

The `tracker` role is optional.

| Choice | Starts from | Writes to the ticket |
| --- | --- | --- |
| Linear | Linear ticket events and manual starts | Moves the issue to its in-progress status by default and posts comments |
| Jira | Jira issue events and manual starts | Moves the issue to an in-progress status by default and posts comments |
| ClickUp | ClickUp task events and manual starts | Moves the task to a chosen in-progress status by default and posts comments |
| No tracker | Manual starts only | Nothing |

Every composition keeps the `manual` trigger. Without a tracker, the workflow has no tracker tools and no write-back jobs.

## Start a task manually

A manual start, such as a dispatcher's `start_workflow_run` call, passes these inputs. Pass each value as a string.

| Input | Required | Value |
| --- | --- | --- |
| `repository` | Yes | The repository as `owner/name`. The run stops when it differs from the project's repository. |
| `title` | Yes | A short title for the task. |
| `description` | Yes | What to change and why. |
| `acceptance_criteria` | Yes | How a reviewer checks that the change is done, such as a Markdown list. |
| `url` | No | Link to the source, such as the Slack thread or the ticket. The PR body links it. |
| `request` | No | Extra instructions from the person who asked. |
| `ticket_id` | No | The tracker's ID for the ticket. For Jira, the issue ID or key. With a tracker, the default option moves it to an in-progress status and posts comments. |
| `identifier` | No | The ticket key, such as `ENG-123`. It names the branch and the PR reference. Without it, the run uses `task-<run number>`. |

A manual start without a required input fails before the agent starts and writes nothing.

A ticket loader passes `ticket_id`, `identifier`, and `url` with the ticket's content. Two starts with the same `identifier` cannot both open a PR, because the second finds the first run's branch and stops.

A dispatcher without a ticket leaves `ticket_id` and `identifier` empty. Each such start opens its own PR. The `idempotency_key` of `start_workflow_run` prevents duplicates only within the dispatcher's own run, so the dispatcher must not start one request twice.

## Choose a first task

The first test run needs a task. When the user has no task in mind, read the repository and propose two or three small, verifiable changes. Good candidates are a missing test, a `TODO` with a clear fix, or an outdated README section. Prefer changes that the test command checks quickly. Give each a title, a description, and acceptance criteria. Do not propose changes to CI configuration, secrets, dependencies, or generated files. Let the user pick one or describe their own, then pass it as the manual inputs.

## Start the next task

Without a tracker, the workflow starts only manually, with inputs. A run started from the dashboard Run button has no inputs, so it fails before the agent starts and writes nothing. After the user merges the workflow pull request, which adds the file under `.shipfox/workflows/`, they ask their coding agent to start it with a new task. The agent calls `fire_manual_trigger` with the inputs above. With a tracker, a Linear or Jira ticket also starts it, as the trigger option sets.

## Read the outcome

When the run succeeds, it publishes these workflow outputs in its `run.completed` event:

| Output | Value |
| --- | --- |
| `status` | `implemented` or `needs_clarification`. |
| `identifier` | The task identifier used for the branch. |
| `questions` | The agent's questions when `status` is `needs_clarification`. Empty otherwise. |
| `pr_number` | The opened PR number, or `0` when no PR opened. |
| `pr_url` | The opened PR URL, or empty. |
| `branch` | The branch the run created. |

A failed or cancelled run publishes no outputs. The starting workflow reads the run status instead.

With the feedback loop on, the run stays open until the PR closes. Its `run.completed` event arrives then, not when the PR opens.

## Unclear and unsupported tasks

The agent makes no changes and sets `status` to `needs_clarification` when:

- The task is too unclear to implement safely.
- The acceptance criteria are missing, contradictory, or impossible to check.
- The task needs changes outside the project's repository, or is not a code change.

The run then opens no PR. With a tracker and a ticket, it posts the questions as a ticket comment. Otherwise, the starting workflow reads them from the `questions` output.

## Choose the options

### Linear trigger

The `trigger_style` option applies only to Linear. Keep one trigger block. `agent_session` starts when the agent is assigned or mentioned. `label` starts when an issue is created with the chosen label or gets it later.

Replace every `replace-with-team-key` value with the key of the Linear team whose issues belong to this repository, such as `ENG`. Use local Linear MCP tools to look up the team when available. If the repository does not identify one team, ask the user. Keep this filter: it runs before the workflow and agent start. An agent cannot safely select a team after a broad trigger.

If you remove the team filter, every project that uses this template could open a PR for the same issue. For `label`, also replace every `replace-with-label-name` value with the label's exact name. Check the team key and label name against a journaled event before a real run.

The workflow's own Linear writes do not start it again. Its comments do not mention the agent, so they create no agent session. A status change adds no label.

### Jira trigger

The `jira_trigger` option applies only to Jira. Keep one trigger block.

- `label` starts when an issue is created with the label or gets it later. Use it when people pick tickets for the agent one by one.
- `status` starts when an issue moves to a status, such as `Ready for dev`. Use it when a board column already means "ready to implement". Issues created directly in that status do not start it.

Replace every `replace-with-project-key` value with the key of the Jira project whose issues belong to this repository, such as `ENG`. Without it, every project that uses this template would open a PR for the same issue. For `label`, also replace every `replace-with-label-name` value with the label's exact name. For `status`, replace `replace-with-start-status` with the status's exact name. Check the project key, label, and status against a journaled event before a real run.

The workflow's own Jira writes do not start it again. A comment changes no label or status. The in-progress move leaves the start status, and the run skips it when the start status is already in the In Progress category.

Each Jira connection covers one Jira site, identified by the `cloudId` in its events. With several Jira connections, bind the one whose site holds the project, and check the `cloudId` of a journaled event from that project.
### ClickUp trigger

This option applies only to ClickUp. Keep one `clickup_trigger` block. `tag` starts when a task gets the chosen tag. `status` starts when a task moves to the chosen status, including a task created in that status.

Replace `replace-with-list-id` with the ID of the ClickUp List whose tasks belong to this repository. The event carries the List ID in each change record's `parent_id`. For `tag`, replace `replace-with-tag-name` with the tag's exact name. For `status`, replace `replace-with-trigger-status` with the status's exact name. ClickUp sends tag and status names in lowercase, so check them against a journaled event before a real run.

ClickUp sends several events for one action, such as `taskUpdated` next to `taskTagUpdated`. Each trigger matches one specific event name, so one action starts one run.

The workflow's own ClickUp writes do not start it again. It never changes tags. Its comments send a comment event, which no trigger matches. With `status` and `comment_and_transition`, the in-progress status must differ from the trigger status.

### Feedback loop

The feedback loop is on by default. It stays active until the PR closes and handles two kinds of events:

- Inline review comments from repository owners, organization members, collaborators, and bots.
- Failed GitHub Actions runs on the PR branch. Failures on an older commit are skipped.

It does not handle review summaries, PR conversation comments, or other CI providers. Events arriving within a minute are handled together. Each push can make automated reviewers comment again, so the loop can run many times on an active PR.

Choose `off` to stop after opening the PR.

The agent reads each comment's full thread and decides one of these outcomes:

- `apply` changes the code.
- `answer` replies without a change.
- `already_addressed` points to the code that handles it.
- `needs_human` explains why a person must decide.
- `ignore` neither replies nor changes code. It is for acknowledgements and chatter from other bots.

It applies a person's in-scope request unless the request is unsafe. It applies a bot's finding only after confirming it in the current code. Every reply ends with a hidden marker, and the listener skips comments that contain it. This keeps the agent from answering itself.

### Thread resolution

This option matters only when the feedback loop is on. Keep one marked `resolve_threads` block in the `reply` step's prompt and integrations. `addressed` resolves a thread after the fix is pushed or the code is confirmed to handle the comment. Reviewers can reopen resolved threads. `never` leaves every thread for reviewers.

### Pull request mode

Choose `draft` or `ready` for `pr_mode`. The default opens a draft PR. Set the marked `draft` value to `false` for a ready PR.

### Ticket write-back

This option applies only with a tracker. By default, `comment_and_transition` moves the issue to its in-progress status when work starts. It posts the PR link after opening a PR, or questions when the issue is unclear. Choose `comment` to post comments without changing status, or `none` to make no ticket updates.

Jira moves an issue through transitions, and the available transitions depend on the project's workflow and the issue's current status. When the issue's status is still in the To Do category, the run reads the transitions at work start and applies the first one that leads to an In Progress category status. It skips the move when the issue is already in progress or done, or when no such transition exists.

ClickUp statuses belong to each List. Replace `replace-with-in-progress-status` with the exact name of the List's in-progress status, such as `in progress`. The run sets that status when work starts, whatever the task's current status.

Both write-back choices also post the agent's questions when the ticket is too unclear to implement. The run writes only when it has a ticket ID from an event or the `ticket_id` input. Status updates get up to five attempts. Persistent failures stop implementation. The PR link is written separately, so a failed comment does not stop the feedback loop.

## Bind the model and connections

Confirm that the model and thinking level on the `fix` steps are available in the workspace. The implementation and feedback steps continue one `ticket_pr` session, so every `# model:fix` step must use the same model and harness. The `# model:reply` step only posts prepared replies, so a smaller model is enough.

Replace `linear_tracker`, `jira_tracker`, or `clickup_tracker` with the tracker connection slug and `github_source` with the project's GitHub source connection slug. Keep the same GitHub slug in every step and listener.

## Fill the command slots

Replace each `# slot:setup_commands` line with the repository's setup steps at that indentation. Setup runs before any agent step, so the agent can run checks while it works. A later step fails if setup leaves tracked changes or unignored untracked files in the working tree.

Replace each `replace-with-test-command` with the test command that proves the change, and keep the rest of the line. The output goes to `.git/shipfox-test.log`, which the agent reads when the gate restarts it.

## Expected writes

Each run creates one branch named `shipfox/<identifier>-<run number>-<attempt>`, pushes one commit, and opens one task pull request. Merging the task pull request ships the change but does not install the workflow. The PR body ends with `Fixes <identifier>` for a ticket, so Linear links the PR to the issue when the workspace has Linear's GitHub integration. Jira shows the PR on the issue when the site has the GitHub for Jira app, because the branch name and PR body contain the issue key. A ClickUp task's identifier is `CU-<task ID>`, which ClickUp's GitHub integration links to the task. Without a ticket, it links the task's `url`. The run stops before the agent starts when another run already has a branch for the same identifier. Close that PR and delete its branch to start again.

Ticket updates can move an issue to its in-progress status when work starts and post a comment with the PR link. Jira comments and transitions appear as the Atlassian user who connected Jira. When the agent asks questions instead, the run posts at most one comment and opens no PR.

A feedback execution can push one commit, reply to review comments, and resolve threads. It pushes only when the PR head has not moved since checkout. The implementing and feedback agents get only read tools. Shell steps, tool steps, and the `reply` step own the writes. Agent steps can still reach the repository's write credential from their shell.

Before a full dev run, check the event filter and the repository. Use a real journaled event, or manual inputs when none matches. A failed run can already have pushed a branch, opened a PR, or posted a comment; inspect those writes before retrying.

## Verify the workflow

Before relying on an adapted workflow, check these paths:

- Start it manually with a small, clear task. Check the PR, its source link, and the `status` and `pr_url` outputs.
- Start it manually without `acceptance_criteria`. Check that the run fails before the agent starts.
- Start it manually with another repository in `repository`. Check that the run stops before setup.
- Start it with an unclear task. Check that no PR opens and that `questions` holds the agent's questions.
- With a tracker, start it from a ticket event. Check that the issue moves to its in-progress status before the agent starts. Check that the status change and the PR comment start no new run.
