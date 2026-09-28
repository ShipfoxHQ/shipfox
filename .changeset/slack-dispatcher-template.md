---
"@shipfox/workflow-templates": minor
---

Adds the `slack-dispatcher` template. When someone mentions the Slack app in a listed channel, an agent reads the thread and picks one workflow from a list in its prompt. Each entry describes what the workflow does and its inputs. The workflow then starts the chosen workflow with `start_workflow_run` and links the run in the thread. The starter list routes to the `ask-codebase`, `slack-to-ticket`, and `ticket-to-pr` templates.

An output `enum` limits the agent to the listed workflows in the dispatcher's project. A check rejects inputs that name another Slack thread. The agent asks when the request is unclear or an input is missing, and points to the earlier run for a repeated request. When the task to pull request workflow opens its pull request, a listening job posts the link or the agent's questions. The dispatcher has no manual trigger, so no routed workflow can start it again.
