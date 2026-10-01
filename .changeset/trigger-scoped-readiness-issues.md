---
'@shipfox/api-triggers': minor
'@shipfox/api-triggers-dto': minor
---

The workflow readiness route now reports trigger-scoped issues. A trigger whose `secrets:` mapping points at a secret that exists at neither project nor workspace scope gets `trigger-secret-missing`, which blocks that trigger's runs from starting. A `secrets.inputs.K` the workflow reads but a trigger's mapping does not provide gets `secret-input-unmapped`, which fails the step that reads it.
