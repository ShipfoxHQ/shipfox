---
"@shipfox/workflow-templates": minor
---

Adds `rank` and `start_label` to template manifests. Each loaded template now reports `startsManually`, and the loader rejects a template without a manual trigger when it has no `start_label`. Adds `buildTemplatePrompt`, also exported from the browser-safe `@shipfox/workflow-templates/prompt` subpath. Each of its `choices` is a full clause, such as `with Slack as the report` or `without the tracker part`.
