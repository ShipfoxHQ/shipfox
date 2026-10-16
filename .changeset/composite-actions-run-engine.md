---
"@shipfox/api-workflows": minor
"@shipfox/api-workflows-dto": minor
"@shipfox/api-definitions": major
"@shipfox/workflow-document": minor
---

Composite actions run. A composite step becomes a parent row that the server opens and closes, and its inner steps run in the calling job.

- **Breaking:** sync always accepts composite actions, so the `compositeActionsEnabled` option of `fetchAndParseWorkflows` and `resolveDefinitionAtRef`, and the `compositeActions` option of `resolveWorkflowActions`, are gone. Inner reads of the composite's `inputs` fill when the step dispatches.
- **Run model:** step rows gain `parent_step_id` and the `composite` type, and a step skipped because its composite did not run has the `composite_skipped` reason. Job executions store the `actions_dir` the setup step reports.
- **Lifecycle:** opening a composite fills its `with` into typed inputs, and its `env` and working directory become the base of its inner steps, filled again each time it opens. Inner steps read the composite's `inputs`, their own `steps`, and `action.path`, and their `run_after` looks at earlier inner steps only. The composite closes as soon as its inner steps finish: it fails when one of them failed, and otherwise fills its outputs, keeping their types. Its gate then runs like any step's.
- **Restarts:** a `restart_from` target is an earlier step of the same scope. A job step can restart a whole composite, which opens again with a new attempt.
- **Sessions:** an agent session key inside a composite is scoped to the use, unless the key is exactly an input.
- **Action files:** a runner step inside composite actions carries `action_bundles`, the digests of every composite that holds it. The action bundle route takes a `digest` query parameter and serves those bundles too. `actionBundleDirectoryName` in `@shipfox/workflow-document` names the directory a runner extracts a bundle into, which `action.path` points at.
- **Routes:** `GET /workflows/runs/:id/action-snapshots/:digest/files/:path` returns a composite's manifest.
- **DTOs:** step DTOs gain `parent_step_id`, the `composite` type, and `source_location.file`. The step report gains `actions_dir`.
