---
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-secrets-dto": minor
---

Step dispatch fills the `runner` context and turns `hashFiles()` calls into runner bindings.

- **`@shipfox/api-workflows-dto`:** adds `stepBindingSchema`, whose segments are `literal`, `secret`, or `hash_files` with its `patterns`. Step configs keep bindings under `secret_bindings`.
- **`@shipfox/api-secrets-dto`:** exports `secretBindingLiteralSegmentSchema`, `secretBindingSecretSegmentSchema`, `secretBindingAnyTargetSchema`, and `SecretBindingTargetDto` so the step binding schema reuses them.
- **`@shipfox/api-workflows`:** `nextStepForLeasedJobExecution` accepts a `runnerPlatform` loader, called once per request and only for a step that reads `runner`. An action input filled on the runner must be a string input, whether it reads a secret or calls `hashFiles()`.
