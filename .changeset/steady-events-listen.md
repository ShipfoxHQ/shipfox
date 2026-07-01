---
"@shipfox/api-definitions": patch
"@shipfox/api-workflows": patch
"@shipfox/api-workflows-dto": patch
"@shipfox/expression": minor
"@shipfox/workflow-document": minor
---

Adds listening-job authoring fields and trusted execution context validation for listening jobs.
Separates workflow identifiers so internal rows use UUID `id`, authored workflow/job/step
references use `key`, and UI labels use `name`.
