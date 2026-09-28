---
"@shipfox/api-secrets-dto": minor
"@shipfox/api-workflows": patch
---

Action steps pass secrets to their inputs by reference.

- **Binding target:** a secret binding's `target` is either an environment variable name, as before, or `{kind: 'input', name}` for an action input. Run-step bindings keep their shape.
- **Dispatch:** a `with` input whose whole value is a secret reference becomes an input binding. The step config and the evaluation trace hold only the reference, never the value. The input must be declared as a string, or the attempt fails with `action_input_invalid`.
- **Step secrets:** `GET /runs/jobs/current/steps/:stepId/secrets` serves action steps as well as run steps.
