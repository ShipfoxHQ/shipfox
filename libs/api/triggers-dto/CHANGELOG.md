# @shipfox/api-triggers-dto

## 34.0.0

### Minor Changes

- 2e5a311: Dev runs accept action uploads. `POST /dev-runs` and the `create_dev_run` MCP tool take an `actions` field: whole action directories, each replacing the ref's copy of its `uses` path. Both routes accept bodies up to 4 MiB. The `create_dev_run` description tells agents which files to send. The run DTO's `dev_source` gains `local_actions`, the uploaded action paths. It defaults to an empty list for older runs.
- a9e85c1: Exposes the missing variable in refused manual starts and trigger history. The 422 `workflow-interpolation-unresolvable` details carry optional `variable_key`, `job_key` and `step`. The `interpolation-unresolvable` diagnostic gains optional `variableKey`, `jobKey`, `step` and `source`, and a missing secret input records its own `secret-input-missing` diagnostic instead of `unexpected-workflow-start-failure`. A manual fire that fails on a missing secret is now recorded as a terminal error.
- fc455ac: Workflow runs materialize and dispatch action steps (`uses`). Definitions accept `uses` only while `DEFINITION_ACTIONS_ENABLED` is on, and it stays off in production for now.

  - **Step type:** steps gain the `action` type. The job detail and agent access step type enums accept it.
  - **Config:** an action step's config carries the action (`uses`, snapshot digest, `main`, and name), its `inputs`, the merged workflow, job, and step `env`, the connection binding of each integration alias, and the manifest outputs with `required`.
  - **Dispatch:** `with` values are completed at dispatch. Defaults fill omitted inputs, and each value is coerced to its declared type. A value that fails coercion fails the attempt with the new `action_input_invalid` reason.
  - **Error reasons:** `stepErrorReasonSchema` adds `action_input_invalid` (user) and `action_unavailable` (setup, for a runner that cannot load the action snapshot). The agent access diagnostics enum adds both.
  - **Interpolation fields:** the workflows and triggers inter-module error schemas accept `action.with`.
  - **Reruns** copy the attempt model, so they run the same action snapshot.
  - **Client:** the step error reason type accepts the two new reasons.

- 6b01f3d: Names the missing variable and where it is read when a run cannot start. `InterpolationUnresolvableError` and the `interpolation-unresolvable` inter-module error carry optional `variableKey`, `jobKey` and `step`. Predicates report `job.if`, `job.success`, `job.listening.filter`, `step.if` and `step.gate.success` instead of `env`. The error message no longer suggests `has()` for a missing variable.
- ac3561b: Names what is missing in MCP tool errors when a run cannot start. `fire_manual_trigger` and `create_dev_run` include the variable key and where it is read, the trigger secret key, runner labels and size figures in the error message and details. `start_workflow_run` does the same. The `interpolation-unresolvable` error from Triggers now carries the optional `variableKey`, `jobKey` and `step`.
- c6f2ae3: `checkRunReadiness` now reports `agent-config-invalid` for an agent step whose model, provider or thinking level the agent module refuses. It checks only steps whose `model`, `provider` and `thinking` are literal or absent, so a templated value never produces an issue. An absent value falls back to the workspace defaults. The issue blocks the start for a normal job, and fails the job when the job is listening or the session key is filled after run creation. The readiness route returns the new issue with its `reason`, `model` and `provider`. `@shipfox/expression` exports `shouldFillAtSite`.
- d77a8c4: Adds `GET /workflow-definitions/readiness`, which reports for up to 100 definitions what the workspace still lacks before their runs can start cleanly. Each issue says where it is read and whether it blocks the run from starting or fails a job after the run starts.
- 507915a: A required action can carry an optional `intent`, and `REQUIRED_ACTION_INTENTS` lists the known values. `intent` names a behavior a composing application may provide in place of opening `url`, such as `contact-support`. `url` stays required as the fallback, and an unknown `intent` still parses.

  The admission denial contract, the HTTP 409 `required_action`, and the agent-access error details now keep `intent` when it is set.

- dd20040: Names the cause of a refused start when an agent step's configuration cannot be used. The agent `agent-config-invalid` error carries a `reason` (`model-unknown`, `provider-unsupported`, `harness-unsupported`, `thinking-unsupported` or `workspace-providers-disabled`) with the `model` and `provider` where they apply. `agent-config-unresolvable` passes them on with the job and step, in the inter-module error, the 422 `details` (`reason`, `model`, `provider`, `job_key`, `step`) and the trigger diagnostic. Every new field is optional, so stored diagnostics still map.
- daf0208: Names the cause of a refused start when an integration connection or tool cannot be materialized. `agent-integration-materialization-failed` carries a `reason` (`connection-missing`, `connection-provider-mismatch`, `source-connection-missing`, `tool-unknown` or `no-tools-selected`) with the `connection` and `tool` where they apply, and the job and step it came from. They reach the inter-module error, the 422 `details` (`reason`, `connection`, `tool`, `job_key`, `step`) and the trigger diagnostic. Setup failures keep no reason. Every new field is optional, so stored diagnostics still map.
- ffffc16: The workflow readiness route now reports trigger-scoped issues. A trigger whose `secrets:` mapping points at a secret that exists at neither project nor workspace scope gets `trigger-secret-missing`, which blocks that trigger's runs from starting. A `secrets.inputs.K` the workflow reads but a trigger's mapping does not provide gets `secret-input-unmapped`, which fails the step that reads it.
- 6b2a308: Adds the workflow outputs runtime. `WorkflowModel` gains optional `outputs` and `outputTypes`. When a run attempt succeeds, its outputs are evaluated with the job-output limits and stored on the attempt. An output that cannot be evaluated or is too large fails the attempt with the `output_invalid` or `output_too_large` status reason. The lifecycle event context returns `run.outputs`, and run creation errors can name the `workflow.outputs` field.

### Patch Changes

- Updated dependencies [e99aa97]
- Updated dependencies [ba1aff7]
- Updated dependencies [807ae57]
- Updated dependencies [c4f486b]
- Updated dependencies [3b3e25c]
- Updated dependencies [fb79732]
- Updated dependencies [2e5a311]
- Updated dependencies [f05ecde]
- Updated dependencies [b9a53b2]
- Updated dependencies [dc8065c]
- Updated dependencies [a73e712]
- Updated dependencies [593142d]
- Updated dependencies [f1f520f]
- Updated dependencies [ef7cf4a]
- Updated dependencies [f7e0fb7]
- Updated dependencies [8872f36]
- Updated dependencies [fc455ac]
- Updated dependencies [ecc70c2]
- Updated dependencies [6b01f3d]
- Updated dependencies [af3b91f]
- Updated dependencies [3869c1d]
- Updated dependencies [a15e118]
- Updated dependencies [4aad893]
- Updated dependencies [d657853]
- Updated dependencies [c6f2ae3]
- Updated dependencies [fafbe84]
- Updated dependencies [737c625]
- Updated dependencies [507915a]
- Updated dependencies [a429987]
- Updated dependencies [94e77bc]
- Updated dependencies [9bac67e]
- Updated dependencies [f6bc1f4]
- Updated dependencies [651153a]
- Updated dependencies [dbe45d5]
- Updated dependencies [dd20040]
- Updated dependencies [daf0208]
- Updated dependencies [00dd046]
- Updated dependencies [6b2a308]
- Updated dependencies [2ab4025]
  - @shipfox/api-secrets-dto@34.0.0
  - @shipfox/api-workflows-dto@34.0.0
  - @shipfox/api-definitions-dto@34.0.0
  - @shipfox/policy-notice@0.1.0

## 33.0.0

### Patch Changes

- @shipfox/api-workflows-dto@33.0.0

## 32.2.0

### Patch Changes

- @shipfox/api-definitions-dto@32.2.0
- @shipfox/api-workflows-dto@32.2.0

## 32.1.0

### Patch Changes

- @shipfox/api-workflows-dto@32.1.0

## 32.0.0

### Patch Changes

- Updated dependencies [212c6b6]
  - @shipfox/api-workflows-dto@32.0.0

## 31.0.0

### Minor Changes

- 9b671f9: Manual trigger firing accepts optional `secretInputs`, pins each secret to its resolved project scope, and fails with `secret-not-found` naming the missing key.
- bcd9232: Adds a specific trigger diagnostic for missing configured secrets.
- 85f3d47: Adds shape-only event-trigger checks and reports whether a replay event was checked.

### Patch Changes

- Updated dependencies [bab2786]
- Updated dependencies [c5c7fa3]
- Updated dependencies [9e170c7]
- Updated dependencies [bcd9232]
  - @shipfox/api-workflows-dto@31.0.0
  - @shipfox/api-secrets-dto@31.0.0
  - @shipfox/api-definitions-dto@31.0.0

## 30.0.0

### Patch Changes

- Updated dependencies [b734fcf]
  - @shipfox/api-workflows-dto@30.0.0
  - @shipfox/api-definitions-dto@30.0.0

## 29.1.0

### Patch Changes

- @shipfox/api-workflows-dto@29.1.0

## 29.0.0

### Patch Changes

- Updated dependencies [e7a8fe4]
  - @shipfox/api-workflows-dto@29.0.0
  - @shipfox/api-definitions-dto@29.0.0

## 28.0.0

### Minor Changes

- 16b21f3: Accepts local workflow `content` with an optional `ref`, and returns the resolved `ref` and validation `warnings`.
  Adds `availableTriggerKeys` and replay-event mismatch fields to refusal details.
- 6338cc4: Adds the `checkDevRun` inter-module command for validating dev-run definitions and trigger filters without starting a run or journaling an event.
- c2f1aab: Allows workflow runs to fire manual triggers with parent-run causation and workflow trigger history.

### Patch Changes

- Updated dependencies [e8f0212]
- Updated dependencies [d62e17e]
- Updated dependencies [7067bc3]
  - @shipfox/api-workflows-dto@28.0.0

## 27.2.0

### Patch Changes

- Updated dependencies [ef44a76]
- Updated dependencies [6ad8c2e]
- Updated dependencies [45cf692]
- Updated dependencies [f5bc959]
  - @shipfox/api-definitions-dto@27.2.0
  - @shipfox/api-workflows-dto@27.2.0

## 27.1.0

### Patch Changes

- Updated dependencies [e0b7bd1]
  - @shipfox/api-workflows-dto@27.1.0

## 27.0.0

### Patch Changes

- @shipfox/api-workflows-dto@27.0.0

## 26.1.0

### Patch Changes

- Updated dependencies [db12613]
- Updated dependencies [cb99d51]
  - @shipfox/api-definitions-dto@26.1.0
  - @shipfox/api-workflows-dto@26.1.0

## 26.0.0

### Minor Changes

- e157b10: Expose `fireManualTrigger` and `createDevRun` as inter-module trigger commands. `fireManualTrigger` accepts an optional idempotency key and reports deduplicated runs.
- 5cb4279: Joins initial workflow runs to resolved concurrency groups with transactional claim admission, claim outbox events, and accurate concurrency-group interpolation errors.

### Patch Changes

- Updated dependencies [da717b1]
- Updated dependencies [5cb4279]
- Updated dependencies [aafce80]
  - @shipfox/api-workflows-dto@26.0.0

## 22.0.0

### Minor Changes

- c392dfb: Adds typed synthetic listener dispatch and shared payload limits for production-shaped E2E coverage.

## 21.2.0

### Minor Changes

- 41e1cfc: Surfaces precise, safe trigger event errors in the event detail callout.

### Patch Changes

- 8407bd1: Rejects oversized listener fire deliveries without suppressing matching resolve events.

## 21.0.0

### Minor Changes

- f3df1e5: Add bounded Agent Access trigger-event detail and facet discovery tools.

## 19.0.0

### Minor Changes

- 5af8d52: Adds project catalog and workflow-definition reads, plus trigger-event summaries, details, and facets.

### Patch Changes

- @shipfox/inter-module@0.2.3

## 15.0.0

### Minor Changes

- 1801f46: Adds `POST /dev-runs` for manually and cron-triggered dev runs. Manual runs build inputs from the request body (overriding the trigger's `with`); cron runs take inputs from the trigger's `with` and reject body inputs. Pins the optional commit, answering 409 `ref-moved` on mismatch and 422 `replay-event-required` for integration-source triggers. Ships the request body schema and `201 {workflow_run_id, commit}` response DTOs in `@shipfox/api-triggers-dto`.
- c6e7526: Adds targeted replay to `POST /dev-runs` for integration-source triggers.
  Requests may provide `replay_event_id` to use the recorded payload and integration connection.
  Manual and scheduled triggers reject `replay_event_id`.
  Refusals return `trigger-filtered` (409), `replay-event-mismatch` (409), `replay-event-not-found` (404), or `replay-event-unavailable` (410).
  Development journal entries retain `replay_of_event_id` for each replay attempt.

## 14.0.0

### Minor Changes

- 05c7c4d: Adds dev-run and replay-link support to trigger journal interfaces and client types.
- b6c7871: Adds `origin` and `replayable` filters to the trigger events list, an `origins` facet, and `replay_of_event_id` with a `replays` list on the event detail response.

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

## 0.1.0

### Minor Changes

- a460020: Add trigger event detail decisions with stored subscription names, run links, and payload inspection.
- 5ec8367: Adds trigger event inspection endpoints with matching DTO schemas for listing received events and reading event decisions.

### Patch Changes

- e5d2f13: Add the workspace **Events** page in Settings: a filterable, cursor-paginated table of
  trigger events (status dot, source/event, routing summary, delivery id, received time)
  mounted at `/workspaces/$wid/settings/events` and wired into the settings sub-nav. Filters
  (date range, source, event, outcome) live in the URL via `validateSearch`, so a filtered
  view is shareable. Source and event filters are populated by a new
  `GET /trigger-events/facets` endpoint that returns each workspace's distinct source/event
  values with counts (top 50, backed by `(workspace_id, source)` / `(workspace_id, event)`
  indexes); the list still renders if facets fail to load.
- a982f20: Stop a permanently-broken trigger subscription from starving its siblings or wedging the outbox. Integration dispatch now attempts every matched subscription and classifies each `runWorkflow` failure: a permanent error (deleted definition or project mismatch) is recorded and skipped, while a transient one re-throws so the outbox replays the event and converges. The event reaches a terminal outcome once no transient error remains (`routed` when any run was created, otherwise the new `errored` outcome), with a guarded write that never records `errored` over an event that already produced a run. The manual-fire path records the same terminal outcome, and `@shipfox/api-workflows` exports an `isPermanentRunWorkflowError` classifier. The trigger-events read API (`triggerEventOutcomeSchema`) accepts the new `errored` outcome for serialization and filtering.
- e192d86: Adds the cron firing engine: a once-per-minute tick fans out bounded drain activities that claim due schedules (FOR UPDATE SKIP LOCKED), advance their next fire time, and fire the workflow deduplicated and crash-safe, recorded in trigger history with a `cron` origin and surfaced through cron fire and backlog metrics.
