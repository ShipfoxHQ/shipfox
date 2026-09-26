---
"@shipfox/api-agent-access-dto": major
"@shipfox/api-agent-access": minor
"@shipfox/workflow-templates": major
---

Replaces `suggested_models` in the `get_workflow_template` result with bounded `model_recommendations`, so the response fits the size limit for any workspace catalog.

Placeholders are grouped by the binding their tested model resolves to. Each group has a mode: `recommended` (the tested model and up to four labelled alternatives), `template_default` (the tested model without scores), `workspace_default` (the tested model is unavailable), or `choose`. Every choice carries its complete binding and `provider_required`.

`@shipfox/workflow-templates` removes `suggestModels` and the manifest `models.<placeholder>.reference` field; the `# model:` line now records the tested setting. The `create-workflow-from-template` skill confirms models per group through a new `choose-models.md` reference.
