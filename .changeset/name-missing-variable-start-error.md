---
'@shipfox/api-workflows': minor
'@shipfox/api-workflows-dto': minor
'@shipfox/api-triggers-dto': minor
---

Names the missing variable and where it is read when a run cannot start. `InterpolationUnresolvableError` and the `interpolation-unresolvable` inter-module error carry optional `variableKey`, `jobKey` and `step`. Predicates report `job.if`, `job.success`, `job.listening.filter`, `step.if` and `step.gate.success` instead of `env`. The error message no longer suggests `has()` for a missing variable.
