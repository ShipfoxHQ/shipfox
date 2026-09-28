---
"@shipfox/api-workflows-dto": minor
"@shipfox/api-agent-access-dto": minor
"@shipfox/api-triggers-dto": minor
"@shipfox/api-workflows": patch
"@shipfox/client-workflows": patch
---

Workflow runs materialize and dispatch action steps (`uses`). Definitions accept `uses` only while `DEFINITION_ACTIONS_ENABLED` is on, and it stays off in production for now.

- **Step type:** steps gain the `action` type. The job detail and agent access step type enums accept it.
- **Config:** an action step's config carries the action (`uses`, snapshot digest, `main`, and name), its `inputs`, the merged workflow, job, and step `env`, the connection binding of each integration alias, and the manifest outputs with `required`.
- **Dispatch:** `with` values are completed at dispatch. Defaults fill omitted inputs, and each value is coerced to its declared type. A value that fails coercion fails the attempt with the new `action_input_invalid` reason.
- **Error reasons:** `stepErrorReasonSchema` adds `action_input_invalid` (user) and `action_unavailable` (setup, for a runner that cannot load the action snapshot). The agent access diagnostics enum adds both.
- **Interpolation fields:** the workflows and triggers inter-module error schemas accept `action.with`.
- **Reruns** copy the attempt model, so they run the same action snapshot.
- **Client:** the step error reason type accepts the two new reasons.
