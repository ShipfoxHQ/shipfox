---
"@shipfox/workflow-templates": minor
---

Adds `rank` and `start_label` to template manifests. The loader derives `startsManually` from every role binding and rejects a template without a manual trigger when it has no `start_label`. Adds `buildTemplatePrompt`, also exported from the browser-safe `@shipfox/workflow-templates/prompt` subpath.
