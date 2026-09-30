---
"@shipfox/workflow-templates": minor
"@shipfox/client-onboarding": patch
---

Exports `FIRST_WORKFLOW_PROMPT` from `@shipfox/workflow-templates/prompt`, next to `buildTemplatePrompt`. The first-workflow panel now reads the prompt from there and still re-exports it, so the eval runner can hand a coding agent the exact prompt the product shows.
