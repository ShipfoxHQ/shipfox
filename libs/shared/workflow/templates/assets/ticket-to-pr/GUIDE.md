# Ticket to pull request

Use this template when a Linear ticket should produce a tested GitHub pull request.

## Prerequisites

- Connect Linear as the tracker and GitHub as the project's source.
- Give the GitHub connection permission to read and write repository contents and pull requests.
- Use GitHub Actions if you turn on the feedback loop.
- The PR body ends with `Fixes <identifier>`. Linear links the PR to the issue when the workspace has Linear's GitHub integration.

## Choose the options

### Trigger

Keep one trigger block. `agent_session` starts when the agent is assigned or mentioned. `label` starts when an issue is created with the chosen label or gets it later.

Replace every `replace-with-team-key` value with the key of the Linear team whose issues belong to this repository, such as `ENG`. Without it, every project that uses this template would open a PR for the same issue. For `label`, also replace every `replace-with-label-name` value with the label's exact name. Check the team key and label name against a journaled event before a real run.

### Feedback loop

`off` removes the `respond_to_feedback` job. `on` keeps it. The job listens to the opened PR until it closes and handles two kinds of events:

- Inline review comments from repository owners, organization members, collaborators, and bots.
- Failed GitHub Actions runs on the PR branch. Failures on an older commit are skipped.

It does not handle review summaries, PR conversation comments, or other CI providers. Events arriving within a minute are handled together. Each push can make automated reviewers comment again, so the loop can run many times on an active PR.

The agent reads each comment's full thread and decides one of these outcomes:

- `apply` changes the code.
- `answer` replies without a change.
- `already_addressed` points to the code that handles it.
- `needs_human` explains why a person must decide.
- `ignore` neither replies nor changes code. It is for acknowledgements and chatter from other bots.

It applies a person's in-scope request unless the request is unsafe. It applies a bot's finding only after confirming it in the current code. Every reply ends with a hidden marker, and the listener skips comments that contain it. This keeps the agent from answering itself.

### Thread resolution

This option matters only when the feedback loop is on. Keep one marked `resolve_threads` block in the `reply` step's prompt and integrations. `addressed` resolves a thread after its reply is posted, when every decision in it is `apply` or `already_addressed`. The fix must also be pushed. `never` leaves every thread for reviewers.

### Pull request mode

Choose `draft` or `ready` for `pr_mode`. The default opens a draft PR. Set the marked `draft` value to `false` for a ready PR.

### Ticket write-back

Keep the marked blocks for one `ticket_write_back` choice. `comment` posts the PR URL on the Linear issue. `comment_and_transition` also changes the issue status; replace `replace-with-linear-status` with the exact destination status. `none` removes every Linear write. Both write-back choices also post the agent's questions when it finds the issue too unclear to implement. The PR link is written in a separate job, so a failed Linear write does not stop the feedback loop.

## Bind the model and connections

Confirm that the model and thinking level on the `fix` steps are available in the workspace. The implementation and feedback steps continue one `ticket_pr` session, so every `# model:fix` step must use the same model and harness. The `# model:reply` step only posts prepared replies, so a smaller model is enough.

Replace `linear_tracker` with the tracker connection slug and `github_source` with the project's GitHub source connection slug. Keep the same GitHub slug in every step and listener.

## Fill the command slots

Replace each `# slot:setup_commands` line with the repository's setup steps at that indentation. Setup runs before any agent step, so the agent can run checks while it works. A later step fails if setup leaves tracked changes or unignored untracked files in the working tree.

Replace each `replace-with-test-command` with the test command that proves the change, and keep the rest of the line. The output goes to `.git/shipfox-test.log`, which the agent reads when the gate restarts it.

## Expected writes

Each run creates one branch named `shipfox/<identifier>-<run number>-<attempt>`, pushes one commit, and opens one pull request. The run stops before the agent starts when another run already has a branch for the same issue. Close that PR and delete its branch to start again.

Ticket write-back can add a Linear comment and, if selected, change the issue status. When the agent asks questions instead, the run posts one comment and opens no PR.

A feedback execution can push one commit, reply to review comments, and resolve threads. It pushes only when the PR head has not moved since checkout. The implementing and feedback agents get only read tools. Shell steps, tool steps, and the `reply` step own the writes. Agent steps can still reach the repository's write credential from their shell.

Before a full dev run, show the user these writes and let them choose a real journaled event. Check the event filter and the repository first. A failed run can already have pushed a branch, opened a PR, or posted a comment; inspect those writes before retrying.
