---
"@shipfox/api-triggers": minor
"@shipfox/api-triggers-dto": minor
"@shipfox/api-agent": minor
"@shipfox/api-agent-dto": minor
"@shipfox/api-workflows": patch
"@shipfox/api-workflows-dto": minor
"@shipfox/api-integration-core": minor
"@shipfox/api-integration-core-dto": minor
"@shipfox/api-integration-spi": minor
"@shipfox/api-integration-github": minor
"@shipfox/api-integration-gitea": minor
"@shipfox/api-integration-shipfox": minor
"@shipfox/actions": patch
"@shipfox/client-triggers": patch
---

Events and runs stay inside their project's access.

- **Events:** the integration event envelope has an optional `resource`. GitHub and Gitea fill it with the repository of the event.
- **Triggers:** a workflow or listening job in a project whose access excludes the connection or the repository no longer receives the event. The trigger history records the decision as `filtered`, with the reason `project-access`, or `project-deleted` when the project is gone. Dev runs that replay an event apply the same check. The job-activated event and listener subscriptions now carry the project.
- **Agent:** a request or message for a project that excludes the connection is dropped with `project-access` or `project-deleted`, and no other project answers it.
- **Shipfox tools:** `start_workflow_run` no longer takes `project_id` and starts runs only in the caller's project.
