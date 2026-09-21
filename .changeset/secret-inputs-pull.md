---
"@shipfox/api-secrets-dto": minor
"@shipfox/api-workflows": minor
---

Workflow definitions can now reference `${{ secrets.inputs.X }}` for step secret bindings. The step secrets pull resolves inputs pinned on the workflow run.
