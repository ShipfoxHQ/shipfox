---
"@shipfox/workflow-templates": minor
---

The ticket to pull request template is now at revision 3.

- **Opening pull requests:** the push step no longer fails on runner checkouts.
- **Before the agent runs:** setup now runs before the agent, and the run stops when another run already has a branch for the issue.
- **Team scoping:** triggers match one Linear team, and label triggers match the label's name.
- **Unclear issues:** the agent can ask clarifying questions instead of opening a pull request.
- **Pull requests and Linear:** PR titles and summaries describe the change; the PR body ends with `Fixes <identifier>`. Linear write-back runs in its own job.
- **Feedback loop:**
  - It is off by default.
  - When turned on, one listening job handles batched review comments and failed GitHub Actions runs in the implementation session.
  - The agent reads full threads and decides per comment, with an `ignore` outcome.
  - It checks the PR head before pushing.
  - It marks its replies so it never answers itself.
  - The new `resolve_threads` option resolves handled threads.
