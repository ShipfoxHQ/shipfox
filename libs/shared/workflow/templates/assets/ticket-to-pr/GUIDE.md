# Ticket to pull request

Use this template when a Linear ticket should produce a tested GitHub pull request.

## Prerequisites

- Connect Linear as the tracker and GitHub as the project's source.
- Give the GitHub connection permission to read and write repository contents and pull requests.
- Use GitHub Actions if you turn on the CI feedback listener.
- For `label`, choose a Linear label and record its ID from a real `Issue.create` or `Issue.update` event.

## Choose the options

Keep one trigger block. `agent_session` starts when the agent is assigned or mentioned. `label` starts when an issue is created with the chosen label or when that label is added later. Replace every `replace-with-label-id` value with that label's ID. Use a journaled `Issue.create` or `Issue.update` event to confirm the payload and filter before a real run.

Keep `feedback_loop=on` to listen for review comments and failed GitHub Actions runs on the opened pull request. Each listener matches the repository and PR number, then stops when that PR closes or after 24 hours or five executions. Choose `off` to remove both listening jobs.

Choose `draft` or `ready` for `pr_mode`. The default opens a draft PR. Set the marked `draft` value to `false` for a ready PR.

Choose one `ticket_write_back` block. `comment` posts the PR URL on the Linear issue. `comment_and_transition` also changes the issue status; replace `replace-with-linear-status` with the exact destination status. `none` leaves the ticket unchanged.

## Bind the model and connections

Confirm that the model and thinking level on the `ticket`, `fix`, and `review` steps are available in the workspace. If the workspace uses a different setting, confirm it with the user and apply it to every marked step. All steps that resume the `ticket_pr` session must use the same harness.

The ticket and implementation steps resume one conversation. Review and CI executions fork that conversation because their listening jobs can overlap. A fork reads the implementation history without competing for a session write lock. Each execution reads the current PR branch before editing.

Replace `linear_tracker` with the tracker connection slug and `github_source` with the project's GitHub source connection slug. Keep the same GitHub slug in the PR tool and both listeners.

## Fill the command slots

Replace each `# slot:setup_commands` line with the repository's setup steps at that indentation. Use the same setup for the implementation and feedback jobs. Replace each `replace-with-test-command` with the test command that proves the change. The gate restarts from the agent step when tests fail.

## Expected writes

The implementation job commits and pushes a new branch, then opens one pull request. Ticket write-back can add a Linear comment and, if selected, change its status. A review execution can push a follow-up commit and reply to its review comment. A failed CI execution can push a repair commit. The fixing agents cannot write through GitHub integration tools; ordered shell and tool steps own those writes.

Before a full dev run, show the user these writes and let them choose a real journaled event. Check the event filter and the repository first. A failed run can already have pushed a branch, opened a PR, or posted a comment; inspect those writes before retrying.
