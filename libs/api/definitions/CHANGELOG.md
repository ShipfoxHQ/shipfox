# @shipfox/api-definitions

## 34.0.0

### Major Changes

- d273097: `normalizeWorkflowDocument` now reports `checkout-path-required` for a checkout step that does not own the job root and sets no `path`. Input with such a step used to normalize.
- 42829e8: Rejects a step `if` that reads `execution.failed` unless the step sets `run_after: always`, and exports `referencesExecutionFailed` from `@shipfox/expression`. The shipped templates now use `run_after` for their failure handlers and drop the `!execution.failed` and `needs.all(n, n.status == "succeeded")` guards it makes redundant.

### Minor Changes

- 807ae57: Reads the `{file: ./path}` parts of an agent `prompt` at the same commit as the workflow YAML and inlines their text into the definition. Sync and dev runs from a ref both read the files. A missing, empty, or unreadable file fails with the new `prompt-file-invalid` sync error code and names the step and the file. A prompt file joins the content hash, so a commit that changes only a prompt file produces a new definition. Workflows without prompt files keep their hash.
- 6b4ae32: `DEFINITION_ACTIONS_ENABLED` controls whether workflow definitions accept action steps (`uses`). It defaults to `false`, and to `true` when `NODE_ENV` is set to a value other than `production`. Definition validation, sync, and dev runs read it. Until action steps are normalized, a parsed `uses` step fails validation with "not supported yet".
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

- 24ea599: Adds a feature flags seam. `@shipfox/feature-flags` declares flags with `defineFlags`. `@shipfox/node-feature-flags` reads them through `createFeatureFlags({provider?})`, resolving a `FLAG_*` env override, then the provider, then the code default. A read never throws. `ShipfoxModule` gains an optional `flags` field, and `defaultModules` accepts a root-created `featureFlags` instance, hands it to the modules, rejects a duplicate flag key, and fails startup on an invalid `FLAG_*` value.

  `DEFINITION_ACTIONS_ENABLED` is replaced by the `definitions-actions` flag, read per workspace. Set `FLAG_DEFINITIONS_ACTIONS=true` where you set `DEFINITION_ACTIONS_ENABLED=true`. The flag defaults to `false`, and the old setting no longer has any effect. The development `.env` sets the override, so local development keeps action steps on.

- f1f520f: Adds the job `container` field to the workflow document, and the `job.container.*` expression fields. The field is a string or an object with `image`, `credentials`, `env`, `options`, and `docker_socket`. `parseWorkflowDocument` rejects it unless `jobContainers` is set, and `buildWorkflowJsonSchema` leaves it out unless `containers` is set. The workflow model carries the normalized container, and snapshots that include one use version 5.
- 8872f36: Shipfox lifecycle events now resolve their workflow context by lineage, so `source: shipfox` triggers dispatch instead of being dropped. The definitions contract adds a `getWorkflow` method for this lookup.
- a99c11b: Show managed models that a workspace cannot run. The workspace model catalog marks them `locked`, validation warns with `model-locked` and never rejects, and the model lists mark them with a lock and explain the reason once, with the required action, while keeping them selectable.
- af3b91f: Definition validation normalizes action steps (`uses`) into the workflow model.

  - **Model:** `WorkflowModelActionStep` carries the action's path, snapshot digest, name, entry file, input declarations, and integration bindings, plus `with`, `env`, and outputs from the manifest. Every output declares `required` explicitly, and the manifest default is `false`.
  - **Validation:** `DefinitionValidationOptions.actionManifests` supplies the manifest and digest for each `uses` path. A step is checked against its manifest: known inputs, required inputs, literal input types, secrets only as whole top-level input values, one connection per integration alias, and connections that exist, match the alias provider, and serve agent tools. Manifest selectors must exist in the provider catalog, and write tools need `allow_write`. An action without a resolved manifest fails with "could not be resolved".
  - **Integration context:** `needsIntegrationValidationContext` also returns `true` when a referenced manifest declares integrations.
  - **Workflows:** run creation rejects action steps until they can be materialized.

- 4e3497b: Lets an agent step `prompt` be a list of up to 64 parts. A part is a string or a `{file: ./path}` reference. The normalizer joins string parts with a blank line, and a string `prompt` is unchanged. A `file` part fails with `prompt-file-invalid` until prompt files are supported.
- d657853: Adds `run_after` to steps and jobs. Set it to `success`, `failure`, or `always` to choose when a step or job runs after an earlier failure. It defaults to `success`, and an `if` now adds to it instead of replacing it. Workflows stored before this change keep their current behavior until their file is next synced.
- 96ac908: Adds `log_path` to `steps.<key>`, `steps.<key>.attempts[]`, and `step.restart.from` in workflow expressions, and rejects it in job outputs, workflow outputs, and `tool` step inputs.
- dbe45d5: Adds the action bundle codec. `encodeActionBundle` writes the files of an action directory as canonical JSON with a `sha256:<hex>` digest and a gzipped stored form, and `decodeActionBundle` reads it back after checking the digest.

  Definitions stores action snapshots per workspace and digest, and the new `getActionSnapshot` inter-module method returns the manifest, the gzipped bundle as base64, and the byte length of the uncompressed bundle, or the `action-snapshot-not-found` known error.

- e71cded: Accepts top-level workflow `outputs`. The document schema takes a map from output names to templates, with the job-outputs entry limit. The new `workflow.outputs` expression field reads the `jobs`, `inputs`, `vars`, `workflow`, `run`, `trigger`, and `event` contexts. Definitions normalize the map into `WorkflowModel.outputs` and `outputTypes` and type-check each output against the declared job outputs, so a reference to an undeclared job output is a sync error. The workflow outputs runtime now evaluates under the `workflow.outputs` field.

### Patch Changes

- 026cf88: Adds a relative import check for action bundles: each static `./` or `../` import in a TypeScript or JavaScript action file must resolve to a file inside the action directory. Adds the `es-module-lexer` dependency.
- f05ecde: Dev runs now resolve workflow actions. `resolveDefinitionAtRef` reads each referenced action at the pinned commit, or takes it from the new `actions` uploads. An upload replaces its action directory completely. Uploaded snapshots are stored with source `dev_local`. An upload that no step uses gives an `action-upload-unused` warning. A relative import that does not resolve fails the dev run. Local content and action files together are capped at 1 MiB. `@shipfox/api-definitions-dto` exports `actionUploadsSchema` and `MAX_LOCAL_UPLOAD_BYTES`.
- c865118: Development runs accept a short branch name such as `main` as the ref, and the `create_dev_run` tool explains how to fix a rejected ref.
- 59c3ea8: Reads the central Shipfox Registry by default. `REGISTRY_URL` defaults to `https://api.registry.shipfox.io` and `REGISTRY_TRUSTED_KEYS` defaults to its production signing key. Set `REGISTRY_URL` to an empty value to turn the registry off.
- 1e58954: Adds resolution of action directories referenced with `uses`: reads each directory at a commit, validates its manifest, builds the bundle and digest, and enforces the action size and file-type limits.
- 9906470: Adds `from_file` and `from_stdout` to run step output declarations. A run step can read an output from a file in the job workspace or from its standard output, up to 64 KiB, instead of writing to `$SHIPFOX_OUTPUT`. The run dispatch config carries them as `output_sources`.
- f6bc1f4: Adds `export` to run, agent, action, and tool steps. `export: true` promotes every declared output of the step to a job output of the same name, and `export: [names]` promotes the listed ones. A later job reads them with the usual types. Sync rejects an unknown name, a clash with the job `outputs` map, and two steps that export the same name. A job output exported from a step that did not produce it is omitted instead of failing the job.
- 651153a: Run and agent step output declarations accept a `default`. When a step has no value for an output, for example because it was skipped or its run step succeeded without writing it, later steps and job outputs read the default from `steps.<key>.outputs`. A default that does not match its declared type or `schema` fails sync. `steps.<key>.outputs` now reads the step's current attempt, so a step that a gate restart skips on the rerun no longer shows the previous pass's values, and it is `{}` before the step's first attempt finishes.
- e2e561c: Reads source files as strict UTF-8 and lists symlinks and submodules. Fetching a file that is not valid UTF-8 now fails with the `binary-file-unsupported` reason instead of replacing invalid bytes. Source file listings now report `symlink` and `submodule` entries next to `file` entries. Workflow sync ignores those entries and reports a workflow file that is not UTF-8 text as an invalid definition for that file.
- 00dd046: Definition sync reads the actions that workflows reference with `uses`, at the same commit as the workflows. It stores their snapshots before it applies the definitions. Sync accepts `uses` only while `DEFINITION_ACTIONS_ENABLED` is on.

  - **Change detection:** a workflow with actions hashes its YAML together with the digests of its actions, so a commit that changes only action code produces a new definition. Workflows without actions keep their YAML-only hash.
  - **Sync error codes:** the sync state error code enums add `action-not-found`, `action-invalid`, `action-too-large`, and `action-unsupported-file`, with a migration for `definitions_sync_error_code`. Manifest diagnostics name the `action.yml` path as their file.
  - **Warnings:** a relative import that does not resolve inside an action gives an `action-import-unresolved` warning on the importing file.

- Updated dependencies [e99aa97]
- Updated dependencies [6b4ae32]
- Updated dependencies [af3b91f]
- Updated dependencies [16d18f4]
- Updated dependencies [b97171d]
- Updated dependencies [5f88947]
- Updated dependencies [5a14986]
- Updated dependencies [9806da2]
- Updated dependencies [5588247]
- Updated dependencies [ba0d750]
- Updated dependencies [807ae57]
- Updated dependencies [c4f486b]
- Updated dependencies [d273097]
- Updated dependencies [7fddfc5]
- Updated dependencies [e087b95]
- Updated dependencies [68d6cd6]
- Updated dependencies [e1cfc2a]
- Updated dependencies [e64c10d]
- Updated dependencies [175482e]
- Updated dependencies [3b3e25c]
- Updated dependencies [fb79732]
- Updated dependencies [f05ecde]
- Updated dependencies [2d009f4]
- Updated dependencies [4273dad]
- Updated dependencies [8a4f3d8]
- Updated dependencies [cc644b8]
- Updated dependencies [b76c004]
- Updated dependencies [39c5466]
- Updated dependencies [c06262b]
- Updated dependencies [24ea599]
- Updated dependencies [eab1dd7]
- Updated dependencies [8b16e92]
- Updated dependencies [184305a]
- Updated dependencies [cfd75e4]
- Updated dependencies [48b8237]
- Updated dependencies [fdca5b6]
- Updated dependencies [f1f520f]
- Updated dependencies [ab66d1e]
- Updated dependencies [f7e0fb7]
- Updated dependencies [8872f36]
- Updated dependencies [a99c11b]
- Updated dependencies [ecc70c2]
- Updated dependencies [af3b91f]
- Updated dependencies [f5bdc5b]
- Updated dependencies [e40ec8b]
- Updated dependencies [e3b9558]
- Updated dependencies [c06262b]
- Updated dependencies [9674325]
- Updated dependencies [21c993b]
- Updated dependencies [a26baf5]
- Updated dependencies [5ce9d5b]
- Updated dependencies [55152c5]
- Updated dependencies [c06262b]
- Updated dependencies [a15e118]
- Updated dependencies [4e3497b]
- Updated dependencies [d657853]
- Updated dependencies [c6f2ae3]
- Updated dependencies [cb411b1]
- Updated dependencies [f64bff1]
- Updated dependencies [0975515]
- Updated dependencies [a509c87]
- Updated dependencies [150d735]
- Updated dependencies [c8857f4]
- Updated dependencies [76fbfe9]
- Updated dependencies [7517867]
- Updated dependencies [5fb1fbd]
- Updated dependencies [b1cc902]
- Updated dependencies [9906470]
- Updated dependencies [42829e8]
- Updated dependencies [d273097]
- Updated dependencies [9674325]
- Updated dependencies [15282f5]
- Updated dependencies [71c11b1]
- Updated dependencies [3c92a34]
- Updated dependencies [257e53e]
- Updated dependencies [e701cfc]
- Updated dependencies [f6bc1f4]
- Updated dependencies [96ac908]
- Updated dependencies [651153a]
- Updated dependencies [dbe45d5]
- Updated dependencies [e2e561c]
- Updated dependencies [dd20040]
- Updated dependencies [00dd046]
- Updated dependencies [da36a04]
- Updated dependencies [fe15ea2]
- Updated dependencies [9485c57]
- Updated dependencies [f9c2dec]
- Updated dependencies [4a664ca]
- Updated dependencies [e663112]
- Updated dependencies [3e8ff99]
- Updated dependencies [70e6983]
- Updated dependencies [15e9d33]
- Updated dependencies [f187551]
- Updated dependencies [d0fcdae]
- Updated dependencies [8786552]
- Updated dependencies [c29a8bb]
- Updated dependencies [a32c90c]
- Updated dependencies [8f54fc9]
- Updated dependencies [a4c05ba]
- Updated dependencies [c14f398]
- Updated dependencies [b0b0a82]
- Updated dependencies [82f2480]
- Updated dependencies [0b2af13]
- Updated dependencies [3c8db4c]
- Updated dependencies [e71cded]
- Updated dependencies [6b2a308]
- Updated dependencies [2ab4025]
- Updated dependencies [70e6983]
- Updated dependencies [89a6cc7]
- Updated dependencies [9549da3]
  - @shipfox/api-secrets-dto@34.0.0
  - @shipfox/workflow-document@3.11.0
  - @shipfox/expression@2.12.0
  - @shipfox/api-auth-context@34.0.0
  - @shipfox/workflow-templates@2.0.0
  - @shipfox/api-definitions-dto@34.0.0
  - @shipfox/api-integration-core-dto@34.0.0
  - @shipfox/api-projects-dto@34.0.0
  - @shipfox/api-agent-dto@34.0.0
  - @shipfox/node-postgres@0.6.0
  - @shipfox/node-fastify@0.5.0
  - @shipfox/feature-flags@0.1.0
  - @shipfox/node-feature-flags@0.1.0
  - @shipfox/node-module@1.2.0
  - @shipfox/node-outbox@0.3.0
  - @shipfox/node-opentelemetry@0.7.0
  - @shipfox/api-registry-dto@34.0.0
  - @shipfox/registry-format@0.1.0
  - @shipfox/node-temporal@0.6.0
  - @shipfox/node-drizzle@0.3.7

## 33.0.0

### Patch Changes

- Updated dependencies [f24d9cd]
  - @shipfox/api-agent-dto@33.0.0

## 32.2.0

### Patch Changes

- Updated dependencies [3494bf1]
  - @shipfox/workflow-document@3.10.0
  - @shipfox/api-agent-dto@32.2.0
  - @shipfox/api-definitions-dto@32.2.0
  - @shipfox/expression@2.11.2

## 32.1.0

### Patch Changes

- Updated dependencies [fd261c8]
  - @shipfox/api-agent-dto@32.1.0

## 32.0.0

### Patch Changes

- Updated dependencies [e87d5a9]
  - @shipfox/api-agent-dto@32.0.0

## 31.0.0

### Minor Changes

- bcd9232: Adds reference-based secret defaults to workflow triggers and pins them when runs start.

### Patch Changes

- Updated dependencies [17d86bf]
- Updated dependencies [da1114b]
- Updated dependencies [792fc53]
- Updated dependencies [3633ccc]
- Updated dependencies [07ca907]
- Updated dependencies [c5c7fa3]
- Updated dependencies [9e170c7]
- Updated dependencies [bcd9232]
- Updated dependencies [bd03ee1]
  - @shipfox/workflow-document@3.9.0
  - @shipfox/api-integration-core-dto@31.0.0
  - @shipfox/api-agent-dto@31.0.0
  - @shipfox/expression@2.11.1
  - @shipfox/api-secrets-dto@31.0.0
  - @shipfox/api-definitions-dto@31.0.0

## 30.0.0

### Minor Changes

- ce729ec: Rejects interpolated secret input names and destinations before a workflow run starts.

### Patch Changes

- 92b30aa: Adds concurrency group expressions to the shared workflow context registry and keeps definition validation and generated reference documentation aligned.
- Updated dependencies [c0c5653]
- Updated dependencies [f05d344]
- Updated dependencies [92b30aa]
  - @shipfox/api-secrets-dto@30.0.0
  - @shipfox/api-integration-core-dto@30.0.0
  - @shipfox/expression@2.11.0
  - @shipfox/api-definitions-dto@30.0.0

## 29.1.0

### Patch Changes

- Updated dependencies [d12820f]
  - @shipfox/api-agent-dto@29.1.0
  - @shipfox/api-auth-context@29.1.0

## 29.0.0

### Minor Changes

- f571b7f: Adds top-level workflow `concurrency` with required `group`. `scope` defaults to `workflow`, and `cancel_in_progress` defaults to `false`. Definitions warns when group roots may be unavailable and rejects unsupported policies.

### Patch Changes

- Updated dependencies [a34066f]
- Updated dependencies [f4f1f10]
- Updated dependencies [f571b7f]
- Updated dependencies [b891938]
  - @shipfox/node-fastify@0.4.7
  - @shipfox/node-drizzle@0.3.6
  - @shipfox/workflow-document@3.8.0
  - @shipfox/api-agent-dto@29.0.0
  - @shipfox/api-auth-context@29.0.0
  - @shipfox/node-module@1.1.2
  - @shipfox/api-definitions-dto@29.0.0
  - @shipfox/expression@2.10.1

## 27.2.0

### Minor Changes

- ef44a76: Adds supplied workflow content support to definition resolution at a pinned ref.
- f5bc959: Adds `getDefinitionByConfigPath` to the definitions contract, returning the synced definition id, workflow id, and name for a project and config path.

### Patch Changes

- Updated dependencies [0827733]
- Updated dependencies [ef44a76]
- Updated dependencies [f5bc959]
  - @shipfox/api-integration-core-dto@27.2.0
  - @shipfox/api-definitions-dto@27.2.0

## 27.0.0

### Patch Changes

- Updated dependencies [45c9598]
  - @shipfox/api-agent-dto@27.0.0

## 26.1.0

### Minor Changes

- db12613: Adds authenticated actor provenance to definition resolution events while keeping automated VCS resolution actorless.

### Patch Changes

- Updated dependencies [db12613]
- Updated dependencies [c2c97ac]
  - @shipfox/api-definitions-dto@26.1.0
  - @shipfox/node-error-monitoring@0.4.0
  - @shipfox/node-fastify@0.4.6
  - @shipfox/node-module@1.1.1
  - @shipfox/node-temporal@0.5.2
  - @shipfox/api-auth-context@26.1.0

## 26.0.0

### Patch Changes

- Updated dependencies [6eaacf0]
- Updated dependencies [db054aa]
- Updated dependencies [4a75c26]
- Updated dependencies [fb73bca]
- Updated dependencies [8229356]
  - @shipfox/api-integration-core-dto@26.0.0
  - @shipfox/api-auth-context@26.0.0
  - @shipfox/node-module@1.1.0

## 25.0.0

### Patch Changes

- Updated dependencies [bba82ae]
- Updated dependencies [701df29]
  - @shipfox/api-auth-context@25.0.0
  - @shipfox/api-agent-dto@25.0.0

## 24.2.0

### Patch Changes

- Updated dependencies [ec852c4]
  - @shipfox/expression@2.10.0
  - @shipfox/api-definitions-dto@24.2.0

## 24.1.1

### Patch Changes

- Updated dependencies [0c00509]
  - @shipfox/expression@2.9.2
  - @shipfox/api-definitions-dto@24.1.1

## 24.1.0

### Minor Changes

- 34b5267: Workflow models expose `group`, `scope`, and `cancelInProgress` concurrency fields.
  Definitions warn when groups reference contexts unavailable to declared triggers.
  Snapshots containing concurrency use version 4. Versions 2 and 3 remain readable.
  Earlier readers reject version 4 snapshots. Upgrade every reader before writing concurrency-bearing snapshots.

### Patch Changes

- d559bdb: Persist the effective gate attempt limit for each run, defaulting new Definitions to five while retaining the legacy three-attempt fallback for older run data.
- Updated dependencies [d559bdb]
- Updated dependencies [34b5267]
- Updated dependencies [dd01977]
  - @shipfox/workflow-document@3.7.0
  - @shipfox/api-definitions-dto@24.1.0
  - @shipfox/config@1.3.0
  - @shipfox/api-auth-context@24.1.0
  - @shipfox/api-agent-dto@24.1.0
  - @shipfox/expression@2.9.1
  - @shipfox/node-error-monitoring@0.3.1
  - @shipfox/node-fastify@0.4.5
  - @shipfox/node-opentelemetry@0.6.6
  - @shipfox/node-postgres@0.5.2
  - @shipfox/node-temporal@0.5.1
  - @shipfox/node-module@1.0.11
  - @shipfox/node-outbox@0.2.7

## 24.0.0

### Minor Changes

- 10f23f7: Detects historical workflow event-payload dependencies and reports listener batch partition warnings.

### Patch Changes

- Updated dependencies [10f23f7]
- Updated dependencies [33f575e]
  - @shipfox/expression@2.9.0
  - @shipfox/workflow-document@3.6.0
  - @shipfox/api-definitions-dto@24.0.0
  - @shipfox/api-agent-dto@24.0.0
  - @shipfox/api-auth-context@24.0.0

## 23.2.0

### Patch Changes

- @shipfox/api-projects-dto@23.2.0
- @shipfox/api-auth-context@23.2.0

## 23.1.0

### Patch Changes

- @shipfox/api-auth-context@23.1.0

## 23.0.0

### Patch Changes

- Updated dependencies [7fed218]
- Updated dependencies [bd5acd2]
  - @shipfox/api-auth-context@23.0.0
  - @shipfox/expression@2.8.0
  - @shipfox/api-definitions-dto@23.0.0
  - @shipfox/api-agent-dto@21.1.0
  - @shipfox/api-integration-core-dto@22.0.0
  - @shipfox/api-projects-dto@21.0.0
  - @shipfox/api-secrets-dto@12.0.0
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.3
  - @shipfox/runner-labels@0.2.1
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-fastify@0.4.4
  - @shipfox/node-module@1.0.10
  - @shipfox/node-opentelemetry@0.6.5
  - @shipfox/node-outbox@0.2.7
  - @shipfox/node-postgres@0.5.1
  - @shipfox/node-temporal@0.5.0
  - @shipfox/workflow-document@3.5.0

## 22.0.0

### Patch Changes

- Updated dependencies [c392dfb]
  - @shipfox/api-integration-core-dto@22.0.0

## 21.2.0

### Patch Changes

- 41e1cfc: Surfaces precise, safe trigger event errors in the event detail callout.
- Updated dependencies [0745878]
- Updated dependencies [351569e]
- Updated dependencies [41e1cfc]
  - @shipfox/node-module@1.0.10
  - @shipfox/node-temporal@0.5.0
  - @shipfox/expression@2.7.0
  - @shipfox/api-definitions-dto@21.2.0

## 21.1.0

### Patch Changes

- Updated dependencies [f534da6]
  - @shipfox/api-agent-dto@21.1.0

## 21.0.0

### Minor Changes

- e225f5e: Adds strict direct integration-tool surfaces and explicit discovery mode to Pi workflow configuration.

### Patch Changes

- Updated dependencies [8825c23]
- Updated dependencies [ff45d70]
- Updated dependencies [b6298b8]
- Updated dependencies [e225f5e]
- Updated dependencies [879f227]
- Updated dependencies [5886bf2]
- Updated dependencies [b5d02d1]
  - @shipfox/expression@2.6.1
  - @shipfox/api-agent-dto@21.0.0
  - @shipfox/api-integration-core-dto@21.0.0
  - @shipfox/api-definitions-dto@21.0.0
  - @shipfox/workflow-document@3.5.0
  - @shipfox/api-projects-dto@21.0.0

## 20.4.0

### Patch Changes

- Updated dependencies [0b32d1a]
  - @shipfox/api-auth-context@20.4.0

## 20.3.0

### Patch Changes

- 813a284: Adds CEL `dyn` support for unknown-shaped tool and JSON outputs, preserves their native runtime values, and keeps listener snapshots compatible during rolling deploys.
- da6fbb8: Reports failed definition sync validation errors with structured diagnostics in the API and workflow UI.
- Updated dependencies [813a284]
- Updated dependencies [da6fbb8]
  - @shipfox/expression@2.6.0
  - @shipfox/api-definitions-dto@20.3.0

## 20.2.0

### Patch Changes

- Updated dependencies [ba481d6]
- Updated dependencies [646373f]
- Updated dependencies [eb45f1d]
  - @shipfox/node-fastify@0.4.4
  - @shipfox/expression@2.5.0
  - @shipfox/api-auth-context@20.2.0
  - @shipfox/node-module@1.0.9
  - @shipfox/api-definitions-dto@20.2.0

## 20.1.0

### Patch Changes

- 6207ce3: Adds bounded workflow run overview and job-page APIs with capped execution counts and source-snapshot enforcement.
- Updated dependencies [2bf937b]
- Updated dependencies [6207ce3]
- Updated dependencies [3ec04b0]
- Updated dependencies [bb334f7]
- Updated dependencies [7467ee6]
  - @shipfox/api-auth-context@20.1.0
  - @shipfox/api-definitions-dto@20.1.0
  - @shipfox/api-agent-dto@20.1.0
  - @shipfox/api-integration-core-dto@20.1.0

## 20.0.0

### Minor Changes

- 46ae6a8: Enables authoring integration tool steps with literal tool references, JSON inputs, and result output mappings.

### Patch Changes

- Updated dependencies [46ae6a8]
- Updated dependencies [db83e6c]
- Updated dependencies [ec39327]
- Updated dependencies [533b968]
- Updated dependencies [351f02c]
  - @shipfox/workflow-document@3.4.0
  - @shipfox/api-integration-core-dto@20.0.0
  - @shipfox/api-projects-dto@20.0.0
  - @shipfox/api-auth-context@20.0.0
  - @shipfox/api-agent-dto@20.0.0
  - @shipfox/api-definitions-dto@20.0.0
  - @shipfox/expression@2.4.3

## 19.0.0

### Minor Changes

- 5af8d52: Adds project catalog and workflow-definition reads, plus trigger-event summaries, details, and facets.
- a61dda2: Materializes integration tool steps with typed inputs, mapped outputs, and frozen catalog metadata.

### Patch Changes

- b416c4c: Preserves existing package behavior while simplifying internal control flow.
- Updated dependencies [c07c8e2]
- Updated dependencies [b416c4c]
- Updated dependencies [5af8d52]
- Updated dependencies [a52cd6d]
- Updated dependencies [a225bf8]
- Updated dependencies [75a54d1]
  - @shipfox/api-agent-dto@19.0.0
  - @shipfox/api-auth-context@19.0.0
  - @shipfox/api-integration-core-dto@19.0.0
  - @shipfox/expression@2.4.2
  - @shipfox/node-module@1.0.8
  - @shipfox/node-outbox@0.2.7
  - @shipfox/runner-labels@0.2.1
  - @shipfox/workflow-document@3.3.2
  - @shipfox/api-projects-dto@19.0.0
  - @shipfox/api-definitions-dto@19.0.0
  - @shipfox/api-secrets-dto@12.0.0
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.3
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-fastify@0.4.3
  - @shipfox/node-opentelemetry@0.6.5
  - @shipfox/node-postgres@0.5.1
  - @shipfox/node-temporal@0.4.6

## 18.0.0

### Minor Changes

- a6f242c: Applies each workspace's configured default harness when checking harness-specific tools, thinking, models, and shared sessions. Managed-inference workspaces using Pi can use Pi tool names without declaring the harness.

### Patch Changes

- Updated dependencies [a6f242c]
- Updated dependencies [b2aad90]
  - @shipfox/api-agent-dto@18.0.0
  - @shipfox/api-integration-core-dto@18.0.0
  - @shipfox/api-auth-context@18.0.0

## 17.1.0

### Patch Changes

- Updated dependencies [fd6cee5]
  - @shipfox/api-agent-dto@17.1.0

## 17.0.0

### Patch Changes

- 9fdba44: Hardens tool-step validation while the fields stay reserved:
  - `tool` and `connection` reject interpolation at document parse and at
    workflow-model normalization (`tool-id-invalid`).
  - A tool id that is not a standalone id or `family.method` with a single dot
    fails normalization with `tool-id-invalid`. This covers boundary dots
    (`issue_write.`, `.issue_read.get`) and a second dot
    (`issue_write.update.extra`).
  - The three output-mapping structural failures (a duplicate `result`
    declaration, non-string mapping values, and values that are not exactly one
    expression) now emit `tool-output-invalid` instead of `tool-input-invalid`;
    `tool-input-invalid` stays reserved for input validation failures.

- Updated dependencies [a4f56ff]
- Updated dependencies [ed4981e]
- Updated dependencies [a591e8a]
- Updated dependencies [9f898d9]
- Updated dependencies [9f898d9]
- Updated dependencies [9fdba44]
- Updated dependencies [be5fb95]
  - @shipfox/api-auth-context@17.0.0
  - @shipfox/api-agent-dto@17.0.0
  - @shipfox/node-postgres@0.5.1
  - @shipfox/workflow-document@3.3.1
  - @shipfox/node-outbox@0.2.6
  - @shipfox/api-definitions-dto@17.0.0
  - @shipfox/expression@2.4.1

## 16.1.0

### Minor Changes

- 870523f: Adds the tool step model: a `kind: 'tool'` step in the `definitions-dto` step union (snapshot version 3) carrying `tool`, `connection`, `with`, `outputMappings`, and `templates`, with sync-time validation (`missing-connection-for-tool`, `integration-connection-not-found` / `-not-capable`, `unknown-integration-tool`, `tool-input-invalid`, `tool-input-unknown-key`). `@shipfox/api-workflows` and `@shipfox/api-workflows-dto` add the tool step to the run-graph step type union and its display name. The workflow document parser still rejects tool-step fields, so nothing is user-authorable yet.

### Patch Changes

- Updated dependencies [d1fb0a3]
- Updated dependencies [c1e5dfd]
- Updated dependencies [870523f]
  - @shipfox/api-agent-dto@16.1.0
  - @shipfox/api-definitions-dto@16.1.0

## 16.0.0

### Minor Changes

- 80d0263: Adds authoring checks for shared agent sessions. Checks parallel resume of statically identical session keys across unordered jobs and literal harness disagreement between steps sharing a session key.
- 117edfd: Adds named agent sessions with validated keys and resume or fork modes.

### Patch Changes

- Updated dependencies [568c90b]
- Updated dependencies [03e03c7]
- Updated dependencies [117edfd]
  - @shipfox/api-integration-core-dto@16.0.0
  - @shipfox/api-agent-dto@16.0.0
  - @shipfox/workflow-document@3.3.0
  - @shipfox/api-definitions-dto@16.0.0
  - @shipfox/expression@2.4.0

## 15.0.0

### Minor Changes

- a7804a8: Adds `GET /definitions/at-ref` listing workflow definitions at a git ref with their validation state and the pinned commit, backing the run-from-branch picker.
- 050b796: Adds typed tool-step expression contexts, result-output mappings, and reserved-root validation.
- 1d16b55: Validates trigger sources and events at sync: unknown connection slugs and unlisted provider events warn, and wrong Shipfox-minted events make the trigger inert.

  Replaces the `invalid-cron-event` diagnostic with `invalid-trigger-event`; consumers matching on the old code must migrate, and existing non-canonical trigger events become inert on their next sync.

### Patch Changes

- Updated dependencies [a7804a8]
- Updated dependencies [07410fe]
- Updated dependencies [989eb11]
- Updated dependencies [b7d522a]
- Updated dependencies [050b796]
- Updated dependencies [0b6addb]
  - @shipfox/api-definitions-dto@15.0.0
  - @shipfox/api-agent-dto@15.0.0
  - @shipfox/expression@2.3.0
  - @shipfox/workflow-document@3.2.0
  - @shipfox/api-integration-core-dto@15.0.0
  - @shipfox/node-opentelemetry@0.6.5
  - @shipfox/api-projects-dto@15.0.0
  - @shipfox/node-fastify@0.4.3
  - @shipfox/node-module@1.0.7
  - @shipfox/node-temporal@0.4.6
  - @shipfox/api-auth-context@15.0.0

## 14.0.0

### Major Changes

- f7b3db8: Replaces published definition warning exports and the sync `warnings` field with severity-aware diagnostics, including workflow file paths for the workflows UI.

  Consumers must migrate from `warnings` to `diagnostics`; this release does not provide a legacy-field fallback.

### Minor Changes

- c0fc35b: Adds `resolveDefinitionAtRef` and `listDefinitionsAtRef` inter-module methods that resolve and validate workflow definitions at a git ref without persisting them.
- 4f30864: Trigger `event` is now optional end to end. An omitted event subscribes to every event from its source. Explicit events continue to work unchanged. Built-in manual and scheduled triggers use `fire` and `tick`, respectively.
- aeaa0de: Adds stable workflow lineage identifiers to definition records and the definitions inter-module contract. Existing definitions are reconciled when read or synchronized, so the schema migration does not backfill historical rows.
- 1b71a66: Exposes each provider's event catalog and the fixed-event providers on the integration validation context. Every provider now refuses the reserved `manual` and `cron` connection slugs.

### Patch Changes

- a97890f: Makes trigger-scoped validation errors inert. Reports broken triggers as error diagnostics with their paths while the definition and its other triggers keep syncing.
- a4df8d9: Resolves a workflow lineage id on GET /definitions/:id by selecting the project's default-branch row, or 404 when the file is not on that branch.
- Updated dependencies [c0fc35b]
- Updated dependencies [f7b3db8]
- Updated dependencies [09924ca]
- Updated dependencies [4f30864]
- Updated dependencies [18e9bad]
- Updated dependencies [a4df8d9]
- Updated dependencies [aeaa0de]
- Updated dependencies [c44641f]
- Updated dependencies [1b71a66]
  - @shipfox/api-definitions-dto@14.0.0
  - @shipfox/api-agent-dto@14.0.0
  - @shipfox/workflow-document@3.1.0
  - @shipfox/api-integration-core-dto@14.0.0
  - @shipfox/api-projects-dto@14.0.0
  - @shipfox/expression@2.2.1

## 13.1.0

### Patch Changes

- Updated dependencies [0d3c2e3]
- Updated dependencies [5c100d6]
- Updated dependencies [ca91dc3]
- Updated dependencies [67aab38]
  - @shipfox/api-agent-dto@13.1.0

## 12.3.0

### Patch Changes

- Updated dependencies [3e7fe76]
  - @shipfox/expression@2.2.0
  - @shipfox/api-definitions-dto@12.3.0

## 12.2.0

### Minor Changes

- ce0984d: Preserve structured values when jobs map typed step outputs, normalize them for JSON persistence, and bound materialized job output sizes and entry counts.

### Patch Changes

- 7901a60: Retry workspace workflow definition syncs when an integration connection becomes available.
- Updated dependencies [7901a60]
- Updated dependencies [df2ed79]
- Updated dependencies [ce0984d]
  - @shipfox/api-integration-core-dto@12.2.0
  - @shipfox/api-projects-dto@12.2.0
  - @shipfox/runner-labels@0.2.0
  - @shipfox/expression@2.1.0
  - @shipfox/workflow-document@3.0.1
  - @shipfox/node-opentelemetry@0.6.4
  - @shipfox/api-definitions-dto@12.2.0
  - @shipfox/api-agent-dto@12.2.0
  - @shipfox/node-fastify@0.4.2
  - @shipfox/node-module@1.0.6
  - @shipfox/node-temporal@0.4.5
  - @shipfox/api-auth-context@12.2.0

## 12.0.0

### Major Changes

- 7c4116e: Align predicate property types with their runtime shapes, replace `run.run_name` with `run.workflow_name`, and remove `failed` from `executions` entries.
- adf07e7: Cut over workflow and job display names to literal-only `name` fields, with runtime interpolation supported through `run_name` and `execution_name`.

### Minor Changes

- ee2ce67: Accept a `${{ }}` interpolation in an agent step's `thinking` field. The schema
  still offers the per-harness enum for editor completion, and the dispatcher
  checks the resolved value against the harness levels. An unsupported
  resolved level fails the step.
- 5d2c9cf: Carry checkout steps from workflow normalization through step materialization and surface their setup error category.
- 3d91d1d: Allow workflow context roots in interpolatable fields while preserving host and availability validation. Keep model and provider selection restricted to workflow-authored context so external payloads and step outputs cannot steer agent execution.
- 89f2c18: Expose non-fatal definition validation warnings from the `/validate` response without
  preventing workflow synchronization. Persistence and surfacing for repo-synced definitions
  remain a follow-up.
- 045895c: Remove the unused workflow context trust metadata and related public exports. Allow
  external context in agent model and provider interpolations now that interpolation
  fields no longer enforce source tiers.
- 9e1d599: Carry first-checkout intent through workflow normalization and step materialization for the upcoming runner checkout execution, including implicit-checkout suppression, checkout opt-out, and position-based primary checkout placement.
- 3f781ee: Add workflow run and job execution naming fields to the authoring, expression, and normalized definition contracts.
- 9fdd5e4: Persist definition validation warnings from repository syncs and surface them on the workflow page without changing sync success or run creation behavior.
- 35a42bd: Resolve run and agent step working directories against the runner job workspace.
- 032d316: Scope checkout credential minting to the currently running checkout step and return its fetch depth.
- c2a8e54: Normalize checkout target fields for step-dispatch resolution, reject unsupported job-level checkout fields, and keep the workflow model and runtime checkout contracts aligned.

### Patch Changes

- 01c3dbc: Allow workflow variables in job, step, gate, and listener predicates while preserving the standard availability error for trigger filters.
- e95fdf4: Report an explicit model validation issue for checkout opt-out and checkout steps until their normalization and runtime support lands.
- 285fff2: Persist resolved workflow job execution names and handle dynamic naming failures consistently.
- 4d246d4: Align predicate validation and runtime evaluation with field-specific context contracts.
- 28daafe: Validate literal agent model and provider values during workflow authoring.
- 4444079: Warn when shell positions re-execute workflow-controlled values as code.
- Updated dependencies [ee2ce67]
- Updated dependencies [7c4116e]
- Updated dependencies [5d2c9cf]
- Updated dependencies [e95fdf4]
- Updated dependencies [3d91d1d]
- Updated dependencies [89f2c18]
- Updated dependencies [045895c]
- Updated dependencies [f78740d]
- Updated dependencies [9e1d599]
- Updated dependencies [dea1ffd]
- Updated dependencies [adf07e7]
- Updated dependencies [3f781ee]
- Updated dependencies [9fdd5e4]
- Updated dependencies [285fff2]
- Updated dependencies [4d246d4]
- Updated dependencies [4eb18b8]
- Updated dependencies [28daafe]
- Updated dependencies [f13e8bb]
- Updated dependencies [4444079]
- Updated dependencies [869a792]
- Updated dependencies [8cc5a36]
- Updated dependencies [35a42bd]
- Updated dependencies [d77baaa]
- Updated dependencies [41d558c]
- Updated dependencies [032d316]
- Updated dependencies [c2a8e54]
- Updated dependencies [54c820e]
- Updated dependencies [cb0abfa]
- Updated dependencies [ee2ce67]
- Updated dependencies [7f90b0c]
  - @shipfox/workflow-document@3.0.0
  - @shipfox/api-definitions-dto@12.0.0
  - @shipfox/api-agent-dto@12.0.0
  - @shipfox/expression@2.0.0
  - @shipfox/inter-module@0.2.3
  - @shipfox/node-fastify@0.4.1
  - @shipfox/node-module@1.0.5
  - @shipfox/api-projects-dto@12.0.0
  - @shipfox/api-integration-core-dto@12.0.0
  - @shipfox/node-postgres@0.5.0
  - @shipfox/api-auth-context@12.0.0
  - @shipfox/api-secrets-dto@12.0.0
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-outbox@0.2.6

## 11.0.0

### Patch Changes

- Updated dependencies [71d9ba4]
- Updated dependencies [25158c8]
  - @shipfox/expression@1.2.1
  - @shipfox/api-auth-context@11.0.0
  - @shipfox/api-definitions-dto@11.0.0

## 10.2.0

### Patch Changes

- @shipfox/api-auth-context@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [88ae689]
  - @shipfox/api-projects-dto@10.1.0
  - @shipfox/api-auth-context@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [74f9e31]
- Updated dependencies [a713231]
- Updated dependencies [43ce975]
- Updated dependencies [e9280fc]
  - @shipfox/node-fastify@0.4.0
  - @shipfox/expression@1.2.0
  - @shipfox/api-agent-dto@10.0.0
  - @shipfox/api-projects-dto@10.0.0
  - @shipfox/api-auth-context@10.0.0
  - @shipfox/node-module@1.0.4
  - @shipfox/api-definitions-dto@10.0.0
  - @shipfox/api-integration-core-dto@9.0.2
  - @shipfox/api-secrets-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.2
  - @shipfox/runner-labels@0.1.3
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/node-outbox@0.2.6
  - @shipfox/node-postgres@0.4.4
  - @shipfox/node-temporal@0.4.4
  - @shipfox/workflow-document@2.1.3

## 9.3.0

### Patch Changes

- Updated dependencies [4425c6d]
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/api-auth-context@9.3.0
  - @shipfox/node-fastify@0.3.4
  - @shipfox/node-module@1.0.3
  - @shipfox/node-temporal@0.4.4

## 9.2.0

### Patch Changes

- @shipfox/api-projects-dto@9.2.0
- @shipfox/api-auth-context@9.2.0

## 9.1.0

### Minor Changes

- 2e9d82d: Adds a configurable repository path for workflow definition sync.

## 9.0.3

### Patch Changes

- Updated dependencies [a831b32]
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-fastify@0.3.3
  - @shipfox/node-module@1.0.2
  - @shipfox/node-temporal@0.4.3
  - @shipfox/api-auth-context@9.0.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-agent-dto@9.0.2
  - @shipfox/api-auth-context@9.0.2
  - @shipfox/api-definitions-dto@9.0.2
  - @shipfox/api-integration-core-dto@9.0.2
  - @shipfox/api-projects-dto@9.0.2
  - @shipfox/api-secrets-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/expression@1.1.5
  - @shipfox/inter-module@0.2.2
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-error-monitoring@0.2.2
  - @shipfox/node-fastify@0.3.2
  - @shipfox/node-module@1.0.1
  - @shipfox/node-opentelemetry@0.6.2
  - @shipfox/node-outbox@0.2.6
  - @shipfox/node-postgres@0.4.4
  - @shipfox/node-temporal@0.4.2
  - @shipfox/runner-labels@0.1.3
  - @shipfox/workflow-document@2.1.3

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [8436596]
- Updated dependencies [475ce59]
- Updated dependencies [154e03f]
  - @shipfox/api-secrets-dto@9.0.1
  - @shipfox/runner-labels@0.1.2
  - @shipfox/expression@1.1.4
  - @shipfox/workflow-document@2.1.2
  - @shipfox/api-agent-dto@9.0.1
  - @shipfox/api-auth-context@9.0.1
  - @shipfox/api-definitions-dto@9.0.1
  - @shipfox/api-integration-core-dto@9.0.1
  - @shipfox/api-projects-dto@9.0.1
  - @shipfox/config@1.2.3
  - @shipfox/inter-module@0.2.1
  - @shipfox/node-drizzle@0.3.3
  - @shipfox/node-error-monitoring@0.2.1
  - @shipfox/node-fastify@0.3.1
  - @shipfox/node-module@1.0.0
  - @shipfox/node-opentelemetry@0.6.1
  - @shipfox/node-outbox@0.2.5
  - @shipfox/node-postgres@0.4.3
  - @shipfox/node-temporal@0.4.1

## 9.0.0

### Patch Changes

- a9f9c57: Decouples Definitions and Workflows tests from peer implementation packages and databases.
- c279061: Improves release verification with owner-defined packed contracts, discovery-driven artifact checks, and an early publication preflight.
- Updated dependencies [46aa52f]
- Updated dependencies [02974d6]
- Updated dependencies [4a6d124]
  - @shipfox/api-agent-dto@9.0.0
  - @shipfox/api-integration-core-dto@9.0.0
  - @shipfox/api-secrets-dto@9.0.0
  - @shipfox/api-auth-context@9.0.0
  - @shipfox/api-definitions-dto@6.0.0
  - @shipfox/api-projects-dto@8.0.0
  - @shipfox/config@1.2.2
  - @shipfox/inter-module@0.2.0
  - @shipfox/runner-labels@0.1.1
  - @shipfox/expression@1.1.3
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-error-monitoring@0.2.0
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-module@0.5.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/node-outbox@0.2.4
  - @shipfox/node-postgres@0.4.2
  - @shipfox/node-temporal@0.4.0
  - @shipfox/workflow-document@2.1.1

## 8.0.0

### Major Changes

- de559bb: Moves Agent validation policy behind a versioned inter-module catalog and injects it into Definitions normalization.

### Patch Changes

- Updated dependencies [de559bb]
- Updated dependencies [7f227c6]
  - @shipfox/api-agent-dto@8.0.0
  - @shipfox/api-integration-core-dto@8.0.0
  - @shipfox/api-projects-dto@8.0.0

## 7.1.0

### Patch Changes

- Updated dependencies [ac42c96]
- Updated dependencies [6ce08c0]
  - @shipfox/node-error-monitoring@0.2.0
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-module@0.5.0
  - @shipfox/node-temporal@0.4.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/api-auth-context@7.1.0

## 6.0.0

### Patch Changes

- a8f0545: Adds the versioned Definitions workflow snapshot contract and registered presentation.
- 0bb82a4: Adds the Agent and Integrations inter-module APIs, moving Workflows agent configuration, runtime credential resolution, and integration consumers behind producer-owned clients.
- f73da5d: Enforces bounded API context imports and routes inter-module consumers through producer contracts.
- Updated dependencies [a8f0545]
- Updated dependencies [0bb82a4]
- Updated dependencies [54ce48b]
- Updated dependencies [f4bc2eb]
- Updated dependencies [c0162b0]
- Updated dependencies [7ac43a4]
- Updated dependencies [f262539]
- Updated dependencies [a01e917]
- Updated dependencies [3bb4e26]
- Updated dependencies [a42b575]
- Updated dependencies [8bdc149]
- Updated dependencies [3810996]
- Updated dependencies [b00ed29]
- Updated dependencies [8aa7cd3]
- Updated dependencies [81f9544]
- Updated dependencies [4604a06]
  - @shipfox/api-definitions-dto@6.0.0
  - @shipfox/api-agent-dto@6.0.0
  - @shipfox/api-integration-core-dto@6.0.0
  - @shipfox/node-module@0.4.0
  - @shipfox/node-temporal@0.3.2
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-outbox@0.2.4
  - @shipfox/api-secrets-dto@6.0.0
  - @shipfox/api-auth-context@6.0.0
  - @shipfox/node-fastify@0.2.4
  - @shipfox/inter-module@0.2.0
  - @shipfox/api-projects-dto@6.0.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [2875241]
- Updated dependencies [bb037af]
- Updated dependencies [fb70438]
  - @shipfox/api-integration-core@5.0.0
  - @shipfox/api-integration-core-dto@5.0.0
  - @shipfox/api-agent-dto@5.0.0
  - @shipfox/api-auth-context@5.0.0
  - @shipfox/api-definitions-dto@5.0.0
  - @shipfox/api-projects@5.0.0
  - @shipfox/api-projects-dto@5.0.0
  - @shipfox/api-secrets-dto@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/expression@1.1.3
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-module@0.3.2
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-outbox@0.2.3
  - @shipfox/node-postgres@0.4.2
  - @shipfox/node-temporal@0.3.1
  - @shipfox/runner-labels@0.1.1
  - @shipfox/workflow-document@2.1.1

## 4.0.0

### Patch Changes

- Updated dependencies [5d129d6]
- Updated dependencies [67176d4]
- Updated dependencies [bbba3b7]
- Updated dependencies [1951293]
  - @shipfox/api-integration-core@4.0.0
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/api-projects@4.0.0
  - @shipfox/node-module@0.3.1
  - @shipfox/node-outbox@0.2.2

## 3.0.0

### Patch Changes

- 7a71e7d: Aligns published dependency ranges with the workspace catalog policy.
- 08fc93b: Adds prebuilt production Temporal workflow bundles to API packages and removes runtime workflow compilation.
- Updated dependencies [3976f8c]
- Updated dependencies [6b23868]
- Updated dependencies [7ce5c9e]
- Updated dependencies [c5ee18f]
- Updated dependencies [7a71e7d]
- Updated dependencies [08fc93b]
  - @shipfox/node-module@0.3.0
  - @shipfox/api-integration-core-dto@3.0.0
  - @shipfox/workflow-document@2.1.0
  - @shipfox/node-temporal@0.3.0
  - @shipfox/api-integration-core@3.0.0
  - @shipfox/api-projects@3.0.0
  - @shipfox/expression@1.1.2
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/api-agent-dto@3.0.0
  - @shipfox/node-fastify@0.2.2
  - @shipfox/api-auth-context@3.0.0

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [0cd6dd4]
- Updated dependencies [a68458a]
- Updated dependencies [6eba800]
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/node-module@0.2.0
  - @shipfox/api-integration-core@2.0.0
  - @shipfox/node-temporal@0.2.0
  - @shipfox/api-agent-dto@2.0.0
  - @shipfox/api-auth-context@2.0.0
  - @shipfox/api-definitions-dto@2.0.0
  - @shipfox/api-integration-core-dto@2.0.0
  - @shipfox/api-projects@2.0.0
  - @shipfox/api-projects-dto@2.0.0
  - @shipfox/api-secrets-dto@2.0.0
  - @shipfox/runner-labels@0.1.0
  - @shipfox/config@1.2.1
  - @shipfox/expression@1.1.1
  - @shipfox/node-drizzle@0.2.1
  - @shipfox/node-fastify@0.2.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/node-outbox@0.2.1
  - @shipfox/node-postgres@0.4.1
  - @shipfox/workflow-document@2.0.1

## 0.1.2

### Patch Changes

- Updated dependencies [705dd43]
  - @shipfox/node-outbox@0.2.0
  - @shipfox/api-integration-core@0.1.2
  - @shipfox/api-projects@0.1.2
  - @shipfox/node-module@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [ec75cd5]
- Updated dependencies [6a1fb54]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/node-postgres@0.4.0
  - @shipfox/api-integration-core@0.1.1
  - @shipfox/api-projects@0.1.1
  - @shipfox/node-module@0.1.1
  - @shipfox/node-outbox@0.1.1

## 0.1.0

### Minor Changes

- 3afb7e3: Adds job execution success expressions and execution timeouts to workflow documents.
  Renames job execution IDs in auth, runner, workflow, and timeout event contracts to the explicit `jobExecutionId` / `job_execution_id` shape.
- d635979: Routes workflow materialization and predicate evaluation through persisted planner segments, replacing resolver exports with planned freeze APIs.
- 69d02e5: Adds job-level checkout permissions and persist-credentials fields to workflow documents.
- b74f635: Adds workflow run interpolation context resolution while preserving authored step configuration for reruns and diagnostics.

### Patch Changes

- eb40964: Add an inline `agent` workflow step that the runner runs with the pi harness. A step is an agent step when it carries `model` + `prompt` and no `run`; it takes a free-text `model`, a single `prompt`, and an optional `thinking` level (default `high`). The step runs to process-success (the agent ran to completion) and reports through the existing step protocol with no runner/backend protocol change, so change quality is judged by a downstream `run` + `gate` step. v1 does not persist the agent's work (no diff, commit, or PR).
- 59ba68b: Integrates workflow definitions with accepted workflow documents and normalized workflow models.
- ce062a9: Validates authored agent step integrations against provider tool catalogs and workspace connection capabilities.
- 857879a: Add a definitions-owned workflow model normalizer for accepted workflow documents.
- ae7a63c: Adds daily dispatched outbox row retention with bounded cleanup batches and retention indexes on module outbox tables.
- b525dcd: Let an agent workflow step pick its pi provider with an optional free-text `provider` field (default `anthropic`), threaded to the runner's pi model lookup, and split agent-step failures into a user-fixable `agent_config_invalid` reason (unknown provider, missing runner credentials, wrong provider/model pair) versus `agent_invocation_failed` for genuine provider/API errors.
- 7fa8f0b: Fix VCS sync failing when a manual definition shares a config_path. The
  `definitions_wd_project_id_config_path_unique` index was source-agnostic, so a
  manual (or validated) definition and a ref/sha-keyed VCS definition at the same
  `config_path` collided on an index that was not the VCS upsert's `ON CONFLICT`
  arbiter, raising an unhandled unique violation and breaking sync. The index (and
  the manual upsert predicate) is now scoped to manual rows so the two coexist.

  A CHECK constraint and request validation now bind `source` to its git
  coordinates (vcs rows carry a ref or sha; manual rows carry neither), so the
  index predicate's correctness is enforced rather than incidental.

- f47cff8: Add a definitions-owned workflow YAML parser that returns a shared `WorkflowDocument`.
- 795f440: Adds the listener orchestration loop for long-lived listening jobs: durable event draining, one execution per buffered event, resolution on until, listening deadline, or max executions, and a run-timeout backstop that resolves active listeners.
- 3bea87f: Adds a typed `subscriberFactory` that binds each outbox event name to its payload type at construction, so subscriber handlers receive a typed `(payload, event)` and the per-handler `event.payload as X` casts are gone; a private brand makes the factory the only way to build a module subscriber.
- fa67aa3: Reject workflow definitions whose step run/env/agent/name interpolation references a context root not yet available at that field's fill site, with a message naming when the root becomes available.
- 9a5aac4: Adds cron trigger schedule and timezone fields with source-specific document validation.
- ef1e917: Adds listening-job authoring fields and trusted execution context validation for listening jobs.
  Separates workflow identifiers so internal rows use UUID `id`, authored workflow/job/step
  references use `key`, and UI labels use `name`.
- 61de795: Adds canonical runner label validation and default runner label fallback for workflow definition parsing.
- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
- e1d4972: Evaluate the step gate `success_if` over the `step` self-root (`step.exit_code`, `step.status`) and job `success` over the full typed executions context, both validated against the shared context registry; authored gate expressions move from `exit_code` to `step.exit_code` and job-success now fails closed on a runtime evaluation error.
- Updated dependencies [eb40964]
- Updated dependencies [7bc7498]
- Updated dependencies [067a260]
- Updated dependencies [26fea4b]
- Updated dependencies [0cf66c4]
- Updated dependencies [0948b67]
- Updated dependencies [34ba284]
- Updated dependencies [8f51daf]
- Updated dependencies [3b45d86]
- Updated dependencies [5707d6d]
- Updated dependencies [e689abf]
- Updated dependencies [59ba68b]
- Updated dependencies [ce3e5ca]
- Updated dependencies [b9c3f32]
- Updated dependencies [a81b68c]
- Updated dependencies [115655e]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [cdf8989]
- Updated dependencies [e47f8da]
- Updated dependencies [a68ed61]
- Updated dependencies [1127ba2]
- Updated dependencies [36f871d]
- Updated dependencies [e7b01dd]
- Updated dependencies [de54da2]
- Updated dependencies [d546b88]
- Updated dependencies [58c05ed]
- Updated dependencies [ce062a9]
- Updated dependencies [9086e65]
- Updated dependencies [7b175f5]
- Updated dependencies [7ca4c65]
- Updated dependencies [e9056c7]
- Updated dependencies [5bcdbf4]
- Updated dependencies [8e9c6cb]
- Updated dependencies [f3614ae]
- Updated dependencies [f98c2be]
- Updated dependencies [ae7a63c]
- Updated dependencies [5729548]
- Updated dependencies [d245be8]
- Updated dependencies [f92122b]
- Updated dependencies [b525dcd]
- Updated dependencies [f8f339a]
- Updated dependencies [58f51bd]
- Updated dependencies [570ac69]
- Updated dependencies [857fd73]
- Updated dependencies [aca162b]
- Updated dependencies [7fa8f0b]
- Updated dependencies [998eba3]
- Updated dependencies [3afb7e3]
- Updated dependencies [444ac89]
- Updated dependencies [eb7d5e8]
- Updated dependencies [5d53ed4]
- Updated dependencies [75520ff]
- Updated dependencies [e87731a]
- Updated dependencies [f66f606]
- Updated dependencies [e51d464]
- Updated dependencies [b8e49ff]
- Updated dependencies [5b8ed32]
- Updated dependencies [417f128]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [f85b223]
- Updated dependencies [f0afdf8]
- Updated dependencies [9d3b43a]
- Updated dependencies [d635979]
- Updated dependencies [3bea87f]
- Updated dependencies [82d22e4]
- Updated dependencies [69d02e5]
- Updated dependencies [01be723]
- Updated dependencies [f63c6b0]
- Updated dependencies [e0fee57]
- Updated dependencies [fa67aa3]
- Updated dependencies [9a5aac4]
- Updated dependencies [30d1c82]
- Updated dependencies [ef1e917]
- Updated dependencies [51eb38a]
- Updated dependencies [61de795]
- Updated dependencies [e2fbef8]
- Updated dependencies [8ecba0f]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [2ad300c]
- Updated dependencies [a314b05]
- Updated dependencies [43fd0c1]
- Updated dependencies [950ebef]
- Updated dependencies [6181819]
- Updated dependencies [3ddde91]
- Updated dependencies [1ea2f6a]
- Updated dependencies [ad6056b]
- Updated dependencies [8b9c3e0]
- Updated dependencies [282e66a]
- Updated dependencies [9c149d1]
- Updated dependencies [f88aac9]
- Updated dependencies [e1d4972]
- Updated dependencies [a856155]
- Updated dependencies [78527ce]
- Updated dependencies [b8919da]
  - @shipfox/workflow-document@2.0.0
  - @shipfox/expression@1.1.0
  - @shipfox/api-agent-dto@0.1.0
  - @shipfox/api-integration-core@0.1.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/api-secrets-dto@0.1.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/api-definitions-dto@0.0.1
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/api-integration-core-dto@0.1.0
  - @shipfox/api-projects@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-temporal@0.1.1
  - @shipfox/node-module@0.1.0
  - @shipfox/node-outbox@0.1.0
  - @shipfox/runner-labels@0.0.1
  - @shipfox/api-projects-dto@0.1.0
  - @shipfox/config@1.2.0
