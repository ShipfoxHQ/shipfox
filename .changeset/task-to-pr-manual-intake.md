---
"@shipfox/workflow-templates": minor
---

The ticket to pull request template is now "Task to pull request", at revision 4. A Slack dispatcher, a ticket loader, or a person can start it manually with `repository`, `title`, `description`, and `acceptance_criteria` inputs, plus optional `url`, `request`, `ticket_id`, and `identifier`.

- **Optional tracker:** the `tracker` role is opt-in, so a workspace with only GitHub can use the template. Without a tracker, only manual starts run it.
- **Manual starts:** a start with a missing required input, or a `repository` other than the project's, fails before the agent runs.
- **Outcome:** a successful run publishes `status`, `identifier`, `questions`, `pr_number`, `pr_url`, and `branch` as workflow outputs.
- **Unclear tasks:** the agent asks for clarification when the acceptance criteria are missing or cannot be checked, or when the task needs another repository.
- **Pull requests:** the PR body ends with `Fixes <identifier>` for a ticket, or links the task's source.
- **Tracker parts:** they now set ticket fields on a shared `task` step and own their write-back jobs. The package README documents the new part contract.
