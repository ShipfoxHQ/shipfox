# @shipfox/api-definitions-dto

## 34.0.0

### Minor Changes

- 807ae57: Reads the `{file: ./path}` parts of an agent `prompt` at the same commit as the workflow YAML and inlines their text into the definition. Sync and dev runs from a ref both read the files. A missing, empty, or unreadable file fails with the new `prompt-file-invalid` sync error code and names the step and the file. A prompt file joins the content hash, so a commit that changes only a prompt file produces a new definition. Workflows without prompt files keep their hash.
- 3b3e25c: Definitions record the registry packages they use and report newer versions.

  - **Refs:** Definitions report the registry actions and templates they use. A template with a pre-registry header gets no update notice.
  - **Notices:** `GET /workspaces/:workspaceId/definitions/:definitionId/package-updates` returns, per reference, the latest version, whether it is behind, the highest bump over the skipped versions, whether an action widens its capabilities, the newest changelog entries, and the upgrade prompt for a template. It is separate from the definition read, so definition pages never wait on the registry.
  - **Prompt:** `buildUpgradePrompt` from `@shipfox/workflow-templates/prompt` writes the prompt a user pastes into a coding agent to upgrade a template.

- fb79732: Definition sync and dev runs resolve registry actions, such as `uses: shipfox/slack-thread-digest@1.4.2`. Registry actions turn on when `DEFINITION_ACTIONS_ENABLED` is on and `REGISTRY_URL` is set. Definitions now read `REGISTRY_URL` too, to decide whether to accept registry references.

  - **Resolution:** the Registry module returns a verified version, and the definitions module checks that the bundle's `action.yml` equals the signed manifest. Sync and dev runs store the bundle as a workspace action snapshot with the new `registry` source, so the runtime bundle route and the runner stay unchanged.
  - **Limits:** the 20-action limit per workflow file counts repository and registry actions together. Registry bundles skip the repository size limits and the relative import check, because the registry bundles them. Uploads apply to `./` paths only.
  - **Model:** action steps gain `origin` (`local` or `registry`), and registry steps also carry `package` and `version`. Models stored before this change omit `origin` and mean `local`. The step config sent to the runner carries the same fields.
  - **Sync errors:** a missing version is `action-not-found`. A version that fails verification, an unsupported document format, or a bundle that differs from its signed manifest is `action-invalid`. Both appear as diagnostics on the workflow file that references the action. An unavailable registry fails the sync attempt and retries.
  - **Dev runs:** a registry failure fails the run with an `invalid-definition` message that names the action.

- f05ecde: Dev runs now resolve workflow actions. `resolveDefinitionAtRef` reads each referenced action at the pinned commit, or takes it from the new `actions` uploads. An upload replaces its action directory completely. Uploaded snapshots are stored with source `dev_local`. An upload that no step uses gives an `action-upload-unused` warning. A relative import that does not resolve fails the dev run. Local content and action files together are capped at 1 MiB. `@shipfox/api-definitions-dto` exports `actionUploadsSchema` and `MAX_LOCAL_UPLOAD_BYTES`.
- f1f520f: Adds the job `container` field to the workflow document, and the `job.container.*` expression fields. The field is a string or an object with `image`, `credentials`, `env`, `options`, and `docker_socket`. `parseWorkflowDocument` rejects it unless `jobContainers` is set, and `buildWorkflowJsonSchema` leaves it out unless `containers` is set. The workflow model carries the normalized container, and snapshots that include one use version 5.
- 8872f36: Shipfox lifecycle events now resolve their workflow context by lineage, so `source: shipfox` triggers dispatch instead of being dropped. The definitions contract adds a `getWorkflow` method for this lookup.
- af3b91f: Definition validation normalizes action steps (`uses`) into the workflow model.

  - **Model:** `WorkflowModelActionStep` carries the action's path, snapshot digest, name, entry file, input declarations, and integration bindings, plus `with`, `env`, and outputs from the manifest. Every output declares `required` explicitly, and the manifest default is `false`.
  - **Validation:** `DefinitionValidationOptions.actionManifests` supplies the manifest and digest for each `uses` path. A step is checked against its manifest: known inputs, required inputs, literal input types, secrets only as whole top-level input values, one connection per integration alias, and connections that exist, match the alias provider, and serve agent tools. Manifest selectors must exist in the provider catalog, and write tools need `allow_write`. An action without a resolved manifest fails with "could not be resolved".
  - **Integration context:** `needsIntegrationValidationContext` also returns `true` when a referenced manifest declares integrations.
  - **Workflows:** run creation rejects action steps until they can be materialized.

- d657853: Adds `run_after` to steps and jobs. Set it to `success`, `failure`, or `always` to choose when a step or job runs after an earlier failure. It defaults to `success`, and an `if` now adds to it instead of replacing it. Workflows stored before this change keep their current behavior until their file is next synced.
- f6bc1f4: Adds `export` to run, agent, action, and tool steps. `export: true` promotes every declared output of the step to a job output of the same name, and `export: [names]` promotes the listed ones. A later job reads them with the usual types. Sync rejects an unknown name, a clash with the job `outputs` map, and two steps that export the same name. A job output exported from a step that did not produce it is omitted instead of failing the job.
- 651153a: Run and agent step output declarations accept a `default`. When a step has no value for an output, for example because it was skipped or its run step succeeded without writing it, later steps and job outputs read the default from `steps.<key>.outputs`. A default that does not match its declared type or `schema` fails sync. `steps.<key>.outputs` now reads the step's current attempt, so a step that a gate restart skips on the rerun no longer shows the previous pass's values, and it is `{}` before the step's first attempt finishes.
- dbe45d5: Adds the action bundle codec. `encodeActionBundle` writes the files of an action directory as canonical JSON with a `sha256:<hex>` digest and a gzipped stored form, and `decodeActionBundle` reads it back after checking the digest.

  Definitions stores action snapshots per workspace and digest, and the new `getActionSnapshot` inter-module method returns the manifest, the gzipped bundle as base64, and the byte length of the uncompressed bundle, or the `action-snapshot-not-found` known error.

- 00dd046: Definition sync reads the actions that workflows reference with `uses`, at the same commit as the workflows. It stores their snapshots before it applies the definitions. Sync accepts `uses` only while `DEFINITION_ACTIONS_ENABLED` is on.

  - **Change detection:** a workflow with actions hashes its YAML together with the digests of its actions, so a commit that changes only action code produces a new definition. Workflows without actions keep their YAML-only hash.
  - **Sync error codes:** the sync state error code enums add `action-not-found`, `action-invalid`, `action-too-large`, and `action-unsupported-file`, with a migration for `definitions_sync_error_code`. Manifest diagnostics name the `action.yml` path as their file.
  - **Warnings:** a relative import that does not resolve inside an action gives an `action-import-unresolved` warning on the importing file.

- 6b2a308: Adds the workflow outputs runtime. `WorkflowModel` gains optional `outputs` and `outputTypes`. When a run attempt succeeds, its outputs are evaluated with the job-output limits and stored on the attempt. An output that cannot be evaluated or is too large fails the attempt with the `output_invalid` or `output_too_large` status reason. The lifecycle event context returns `run.outputs`, and run creation errors can name the `workflow.outputs` field.

### Patch Changes

- Updated dependencies [e99aa97]
- Updated dependencies [6b4ae32]
- Updated dependencies [af3b91f]
- Updated dependencies [d273097]
- Updated dependencies [e087b95]
- Updated dependencies [b76c004]
- Updated dependencies [39c5466]
- Updated dependencies [cfd75e4]
- Updated dependencies [f1f520f]
- Updated dependencies [ab66d1e]
- Updated dependencies [f7e0fb7]
- Updated dependencies [ecc70c2]
- Updated dependencies [e40ec8b]
- Updated dependencies [4e3497b]
- Updated dependencies [d657853]
- Updated dependencies [c6f2ae3]
- Updated dependencies [cb411b1]
- Updated dependencies [9906470]
- Updated dependencies [42829e8]
- Updated dependencies [f6bc1f4]
- Updated dependencies [96ac908]
- Updated dependencies [651153a]
- Updated dependencies [dbe45d5]
- Updated dependencies [0b2af13]
- Updated dependencies [3c8db4c]
- Updated dependencies [e71cded]
- Updated dependencies [2ab4025]
  - @shipfox/api-secrets-dto@34.0.0
  - @shipfox/workflow-document@3.11.0
  - @shipfox/expression@2.12.0

## 32.2.0

### Patch Changes

- Updated dependencies [3494bf1]
  - @shipfox/workflow-document@3.10.0
  - @shipfox/expression@2.11.2

## 31.0.0

### Minor Changes

- bcd9232: Adds reference-based secret defaults to workflow triggers and pins them when runs start.

### Patch Changes

- Updated dependencies [17d86bf]
- Updated dependencies [07ca907]
- Updated dependencies [c5c7fa3]
- Updated dependencies [9e170c7]
- Updated dependencies [bcd9232]
- Updated dependencies [bd03ee1]
  - @shipfox/workflow-document@3.9.0
  - @shipfox/expression@2.11.1
  - @shipfox/api-secrets-dto@31.0.0

## 30.0.0

### Patch Changes

- Updated dependencies [92b30aa]
  - @shipfox/expression@2.11.0

## 29.0.0

### Patch Changes

- Updated dependencies [f571b7f]
  - @shipfox/workflow-document@3.8.0
  - @shipfox/expression@2.10.1

## 27.2.0

### Minor Changes

- ef44a76: Adds supplied workflow content support to definition resolution at a pinned ref.
- f5bc959: Adds `getDefinitionByConfigPath` to the definitions contract, returning the synced definition id, workflow id, and name for a project and config path.

## 26.1.0

### Minor Changes

- db12613: Adds authenticated actor provenance to definition resolution events while keeping automated VCS resolution actorless.

## 24.2.0

### Patch Changes

- Updated dependencies [ec852c4]
  - @shipfox/expression@2.10.0

## 24.1.1

### Patch Changes

- Updated dependencies [0c00509]
  - @shipfox/expression@2.9.2

## 24.1.0

### Minor Changes

- d559bdb: Persist the effective gate attempt limit for each run, defaulting new Definitions to five while retaining the legacy three-attempt fallback for older run data.
- 34b5267: Workflow models expose `group`, `scope`, and `cancelInProgress` concurrency fields.
  Definitions warn when groups reference contexts unavailable to declared triggers.
  Snapshots containing concurrency use version 4. Versions 2 and 3 remain readable.
  Earlier readers reject version 4 snapshots. Upgrade every reader before writing concurrency-bearing snapshots.

### Patch Changes

- Updated dependencies [d559bdb]
  - @shipfox/workflow-document@3.7.0
  - @shipfox/expression@2.9.1

## 24.0.0

### Patch Changes

- Updated dependencies [10f23f7]
- Updated dependencies [33f575e]
  - @shipfox/expression@2.9.0
  - @shipfox/workflow-document@3.6.0

## 23.0.0

### Patch Changes

- Updated dependencies [bd5acd2]
  - @shipfox/expression@2.8.0
  - @shipfox/inter-module@0.2.3
  - @shipfox/regex@0.3.0
  - @shipfox/workflow-document@3.5.0

## 21.2.0

### Patch Changes

- Updated dependencies [351569e]
- Updated dependencies [41e1cfc]
  - @shipfox/expression@2.7.0

## 21.0.0

### Minor Changes

- e225f5e: Adds strict direct integration-tool surfaces and explicit discovery mode to Pi workflow configuration.

### Patch Changes

- Updated dependencies [8825c23]
- Updated dependencies [e225f5e]
  - @shipfox/expression@2.6.1
  - @shipfox/workflow-document@3.5.0

## 20.3.0

### Patch Changes

- da6fbb8: Reports failed definition sync validation errors with structured diagnostics in the API and workflow UI.
- Updated dependencies [813a284]
  - @shipfox/expression@2.6.0

## 20.2.0

### Patch Changes

- Updated dependencies [646373f]
- Updated dependencies [eb45f1d]
  - @shipfox/expression@2.5.0

## 20.1.0

### Patch Changes

- 6207ce3: Adds bounded workflow run overview and job-page APIs with capped execution counts and source-snapshot enforcement.

## 20.0.0

### Patch Changes

- Updated dependencies [46ae6a8]
  - @shipfox/workflow-document@3.4.0
  - @shipfox/expression@2.4.3

## 19.0.0

### Minor Changes

- 5af8d52: Adds project catalog and workflow-definition reads, plus trigger-event summaries, details, and facets.

### Patch Changes

- Updated dependencies [b416c4c]
  - @shipfox/expression@2.4.2
  - @shipfox/workflow-document@3.3.2
  - @shipfox/inter-module@0.2.3
  - @shipfox/regex@0.3.0

## 17.0.0

### Patch Changes

- Updated dependencies [9fdba44]
- Updated dependencies [be5fb95]
  - @shipfox/workflow-document@3.3.1
  - @shipfox/expression@2.4.1

## 16.1.0

### Minor Changes

- 870523f: Adds the tool step model: a `kind: 'tool'` step in the `definitions-dto` step union (snapshot version 3) carrying `tool`, `connection`, `with`, `outputMappings`, and `templates`, with sync-time validation (`missing-connection-for-tool`, `integration-connection-not-found` / `-not-capable`, `unknown-integration-tool`, `tool-input-invalid`, `tool-input-unknown-key`). `@shipfox/api-workflows` and `@shipfox/api-workflows-dto` add the tool step to the run-graph step type union and its display name. The workflow document parser still rejects tool-step fields, so nothing is user-authorable yet.

## 16.0.0

### Minor Changes

- 117edfd: Adds named agent sessions with validated keys and resume or fork modes.

### Patch Changes

- Updated dependencies [117edfd]
  - @shipfox/workflow-document@3.3.0
  - @shipfox/expression@2.4.0

## 15.0.0

### Minor Changes

- a7804a8: Adds `GET /definitions/at-ref` listing workflow definitions at a git ref with their validation state and the pinned commit, backing the run-from-branch picker.

### Patch Changes

- Updated dependencies [b7d522a]
- Updated dependencies [a7804a8]
- Updated dependencies [050b796]
- Updated dependencies [0b6addb]
  - @shipfox/expression@2.3.0
  - @shipfox/regex@0.3.0
  - @shipfox/workflow-document@3.2.0

## 14.0.0

### Major Changes

- f7b3db8: Replaces published definition warning exports and the sync `warnings` field with severity-aware diagnostics, including workflow file paths for the workflows UI.

  Consumers must migrate from `warnings` to `diagnostics`; this release does not provide a legacy-field fallback.

- aeaa0de: Adds stable workflow lineage identifiers to definition records and the definitions inter-module contract. Existing definitions are reconciled when read or synchronized, so the schema migration does not backfill historical rows.

### Minor Changes

- c0fc35b: Adds `resolveDefinitionAtRef` and `listDefinitionsAtRef` inter-module methods that resolve and validate workflow definitions at a git ref without persisting them.
- 4f30864: Trigger `event` is now optional end to end. An omitted event subscribes to every event from its source. Explicit events continue to work unchanged. Built-in manual and scheduled triggers use `fire` and `tick`, respectively.

### Patch Changes

- Updated dependencies [4f30864]
  - @shipfox/workflow-document@3.1.0
  - @shipfox/expression@2.2.1

## 12.3.0

### Patch Changes

- Updated dependencies [3e7fe76]
  - @shipfox/expression@2.2.0

## 12.2.0

### Patch Changes

- Updated dependencies [ce0984d]
  - @shipfox/expression@2.1.0
  - @shipfox/workflow-document@3.0.1

## 12.0.0

### Major Changes

- adf07e7: Cut over workflow and job display names to literal-only `name` fields, with runtime interpolation supported through `run_name` and `execution_name`.

### Minor Changes

- ee2ce67: Accept a `${{ }}` interpolation in an agent step's `thinking` field. The schema
  still offers the per-harness enum for editor completion, and the dispatcher
  checks the resolved value against the harness levels. An unsupported
  resolved level fails the step.
- 5d2c9cf: Carry checkout steps from workflow normalization through step materialization and surface their setup error category.
- 89f2c18: Expose non-fatal definition validation warnings from the `/validate` response without
  preventing workflow synchronization. Persistence and surfacing for repo-synced definitions
  remain a follow-up.
- 9e1d599: Carry first-checkout intent through workflow normalization and step materialization for the upcoming runner checkout execution, including implicit-checkout suppression, checkout opt-out, and position-based primary checkout placement.
- 3f781ee: Add workflow run and job execution naming fields to the authoring, expression, and normalized definition contracts.
- 9fdd5e4: Persist definition validation warnings from repository syncs and surface them on the workflow page without changing sync success or run creation behavior.
- 35a42bd: Resolve run and agent step working directories against the runner job workspace.
- c2a8e54: Normalize checkout target fields for step-dispatch resolution, reject unsupported job-level checkout fields, and keep the workflow model and runtime checkout contracts aligned.

### Patch Changes

- Updated dependencies [ee2ce67]
- Updated dependencies [7c4116e]
- Updated dependencies [e95fdf4]
- Updated dependencies [3d91d1d]
- Updated dependencies [045895c]
- Updated dependencies [f78740d]
- Updated dependencies [dea1ffd]
- Updated dependencies [adf07e7]
- Updated dependencies [3f781ee]
- Updated dependencies [285fff2]
- Updated dependencies [4d246d4]
- Updated dependencies [4444079]
- Updated dependencies [d77baaa]
- Updated dependencies [41d558c]
- Updated dependencies [032d316]
- Updated dependencies [c2a8e54]
- Updated dependencies [cb0abfa]
- Updated dependencies [ee2ce67]
- Updated dependencies [7f90b0c]
  - @shipfox/workflow-document@3.0.0
  - @shipfox/expression@2.0.0
  - @shipfox/inter-module@0.2.3

## 11.0.0

### Patch Changes

- Updated dependencies [71d9ba4]
  - @shipfox/expression@1.2.1

## 10.0.0

### Patch Changes

- Updated dependencies [a713231]
  - @shipfox/expression@1.2.0
  - @shipfox/inter-module@0.2.2
  - @shipfox/workflow-document@2.1.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/expression@1.1.5
  - @shipfox/inter-module@0.2.2
  - @shipfox/workflow-document@2.1.3

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [8436596]
- Updated dependencies [475ce59]
  - @shipfox/expression@1.1.4
  - @shipfox/workflow-document@2.1.2
  - @shipfox/inter-module@0.2.1

## 6.0.0

### Minor Changes

- a8f0545: Adds the versioned Definitions workflow snapshot contract and registered presentation.

### Patch Changes

- Updated dependencies [81f9544]
  - @shipfox/inter-module@0.2.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

## 0.0.1

### Patch Changes

- 59ba68b: Integrates workflow definitions with accepted workflow documents and normalized workflow models.
- 7fa8f0b: Fix VCS sync failing when a manual definition shares a config_path. The
  `definitions_wd_project_id_config_path_unique` index was source-agnostic, so a
  manual (or validated) definition and a ref/sha-keyed VCS definition at the same
  `config_path` collided on an index that was not the VCS upsert's `ON CONFLICT`
  arbiter, raising an unhandled unique violation and breaking sync. The index (and
  the manual upsert predicate) is now scoped to manual rows so the two coexist.

  A CHECK constraint and request validation now bind `source` to its git
  coordinates (vcs rows carry a ref or sha; manual rows carry neither), so the
  index predicate's correctness is enforced rather than incidental.

- 9a5aac4: Adds cron trigger schedule and timezone fields with source-specific document validation.
- 61de795: Adds canonical runner label validation and default runner label fallback for workflow definition parsing.
- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
- b8919da: Removes the unused workflow-spec, job, and step schemas now that `@shipfox/workflow-document` owns workflow document parsing, keeping only the still-used `TriggerDto` type.
