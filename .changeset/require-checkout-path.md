---
"@shipfox/api-definitions": major
---

`normalizeWorkflowDocument` now reports `checkout-path-required` for a checkout step that does not own the job root and sets no `path`. Input with such a step used to normalize.
