# @shipfox/workflow-document

## 4.0.0

### Major Changes

- 476e3b1: An `action.yml` can set `steps` instead of `main` to declare a composite action. Sync expands it into the definition model.

  - **Breaking:** `ActionManifest` is now a union of a JavaScript and a composite manifest, so `main` can be `undefined`. Narrow it with `isCompositeActionManifest`. `actionManifestSchema` is a transform, so it no longer exposes `.shape` or `.extend`.
  - **Manifest:** a composite manifest sets `steps` instead of `main`, and has no `runtime`, `post`, or `post_failure`. Its outputs need `value`, and its inputs can set `secret: true`. Inner steps reject `checkout` and `export`, and a tool step needs `connection`. `uses:` and prompt `file:` accept a leading `${{ action.path }}/`. `safeParseActionManifest` rejects composite manifests unless `compositeActions` is set.
  - **Expressions:** `action` is a reserved root, readable only inside a composite action. `buildCompositeScopeEnvironment` types its inner `inputs` and `action`, and `action.outputs` is the field for an output `value`.
  - **Resolution:** composite actions are resolved recursively, at most 5 levels deep. A cycle fails with the new `action-cycle` sync error code, and deeper nesting with `action-nesting-too-deep`. The 20-action limit counts the whole tree, and the content hash covers every action and prompt file in it.
  - **Workflow model:** a `composite` step holds its inner steps, with path ids, scoped `inputs` and `steps`, secret inputs rewritten to the caller's references, and aliases bound to the caller's connections. A nested grant must fit inside its outer alias. Source locations can name the composite file. Snapshots with a composite step use version 6, and `flattenJobSteps` lists a job's steps in run order.

- cfe6ce6: `buildWorkflowJsonSchema` no longer accepts the `containers` option. The schema always includes the job `container` field. Remove `containers` from your call.

  The descriptions of the job `container` fields now state their limits: `image` and `options` cannot read secrets, the image `ENTRYPOINT` and `CMD` do not run, and `options` must not set `--network` or `--entrypoint`.

- 67e55ea: Models concurrent steps: the document fields, normalization, sync rules, and storage.

  **Breaking:** `WorkflowDocumentJob['steps']` now holds steps and `parallel` blocks, so code that reads `job.steps` as a list of steps must use `jobSteps(job)`. `WorkflowModelStep` gains the `wait` and `cancel` kinds, so a `switch` over `kind` must handle them.

  - **Document:** steps gain `background`, `wait`, `wait_all`, and `cancel`, and a job's `steps` can hold a `parallel` block of at least two steps. `jobSteps(job)` yields every step with its document path, `parallel` members included, and every walker over a job document now uses it, so a `uses:` or `prompt` file inside a block is still found. `job.steps` now also holds blocks. `workflowDocumentSchema`, `parseWorkflowDocument`, and `buildWorkflowJsonSchema` accept the five keys. `rawJobSteps(input)` walks the steps of a document that is not parsed yet.
  - **Workflow model:** steps gain `background`, `parallelGroup`, and `joinedAt`, plus `wait` and `cancel` step kinds. Normalization expands each `parallel` block into background steps followed by a wait, resolves `wait_all` to explicit targets, adds a closing wait when background steps are still running, and checks the order rules: a background step needs a `key`, takes no gate, and cannot overlap a `checkout`, a gate cannot restart past a running background step, and concurrent steps cannot share an agent session. A step reads a background step only after the wait that joins it. A model with a concurrent step is stored as snapshot version 8.
  - **Storage:** steps gain `background`, `parallel_group`, and `joined_at`, step attempts gain `cancel_requested_at`, and `wait` and `cancel` are step types. Dispatch context and `env_sources` skip a background step until a wait has joined it.
  - **API:** the step type of a job detail and of the agent access read tools can be `wait` or `cancel`.

### Minor Changes

- be33fe6: An action can declare a `post` entry in `action.yml`, which Shipfox runs at the end of the job.

  - **Manifest:** `post` follows the path rules of `main` and must differ from it. `post_failure` is `warn` (the default) or `fail`, and needs `post`. A repository action must contain the `post` file.
  - **Workflow model:** an action step carries `post` and `postFailure`. Models stored before this change omit both.
  - **SDK:** `defineAction` handlers receive `state.set(name, value)` and `state.get(name)`, backed by the `SHIPFOX_STATE` file. `context` gains `phase`, and `execution` and `main` for a post. `setOutput` throws in a post.
  - **Testing:** `runAction` accepts `phase`, `state`, `executionFailed`, and `mainStatus`, and returns the `state` after the run.
  - **Registry bumps:** `computeActionBump` returns `minor` when `post` is added or removed, `major` when `post_failure` goes from `warn` to `fail`, and `patch` from `fail` to `warn`.

- 6b4ae32: Workflow steps can declare an action with `uses`, and `actionManifestSchema` describes the `action.yml` manifest. Both stay off by default until workflow actions launch.

  - **Action steps:** `uses` takes a normalized repository path that starts with `./`. Other forms, such as `owner/repo@ref`, fail with "not supported yet". `connections` binds manifest aliases to connection slugs, and `with` passes inputs. A secret reference in `with` must be the whole value of a top-level input.
  - **Forbidden fields:** an action step rejects `run`, agent fields, `checkout`, `tool`, `connection`, and `outputs`. Other step kinds reject `uses` and `connections`.
  - **Opt-in:** `parseWorkflowDocument(input, {actions: true})` accepts action steps. Without it, `uses` fails with "Action steps (`uses`) are not supported yet." `buildWorkflowJsonSchema({actions: true})` adds the action fields; the default schema is unchanged.
  - **Manifest:** `actionManifestSchema`, `buildActionManifestJsonSchema`, and the `ActionManifest` types cover `name`, `description`, `runtime`, `main`, typed `inputs` and `outputs`, and `integrations` with explicit selectors.
  - **Messages:** `with` size, depth, and JSON-tree errors now start with "`with`" instead of "Tool `with`".

- 7d20d04: Agent steps read the same repository instructions and skills as a developer's coding agent, and `repository_context` controls them.

  - **Workflow schema:** an agent step accepts `repository_context`: `false` turns repository context off, and the long form sets `instructions` and `skills` separately. Each toggle accepts a `${{ }}` expression that resolves to `true` or `false` when the step is dispatched. `skills` also accepts a list of skill names. The field is registered as the `agent.repository_context` interpolation field.
  - **Agent contract:** `@shipfox/api-agent-dto` exports `agentRepositoryContextConfigSchema`, the instruction file names for each harness (`claude` tries `CLAUDE.md` first and `pi` tries `AGENTS.md` first), the skill directories, the 64 KiB instruction limit, and `AGENT_SHIPFOX_SYSTEM_PROMPT`, the guidance that both harnesses append to their default system prompt.
  - **Session view:** a `shipfox_repository_context` session entry renders as a "Repository context" row that lists the instruction files and skills the step loaded, or shows that they were off.

- 3f1363c: Agent steps accept `mcp_servers`, a map of stdio MCP servers that the runner starts for the step. The agent sees each server tool as `<name>__<tool>`.

  - **Document:** each entry has a literal `command` and `args`, an `env` map whose values support expressions and secrets, and an optional `include` list. Names use lowercase letters, numbers, and single underscores, with at most 20 characters.
  - **Definitions:** `WorkflowModelAgentStep.customMcpServers` keeps each server with its env templates. A server name that matches the tool prefix of an integration connection on the step is rejected with `agent-mcp-server-name-collision`.
  - **Expressions:** the `agent.mcp_servers.env.value` field accepts server and runner contexts.
  - **Materialized config:** `customMcpServers` holds each server with the env values known at dispatch. An env value that reads a secret becomes a secret binding with the new `mcp_server_env` target, and the step secrets route serves agent steps.
  - **Errors:** a server that does not start fails the step with `agent_mcp_server_unavailable`. A materialization collision with the default connection reports `mcp-server-name-collision`.

- 8937e15: An `mcp_servers` entry on an agent step can give a `url` instead of a `command`, for a server that the user runs. The runner connects to it over Streamable HTTP and sends its `headers` with every request.

  - **Document:** an entry sets exactly one of `command` or `url`, and the published JSON schema says so. `url` is a literal `http` or `https` URL. `headers` maps HTTP field names to values that support expressions and secrets. Header names are unique without regard to case, cannot be one the transport sets (such as `Accept` or `Mcp-Protocol-Version`), and values cannot contain line breaks or null bytes. Headers share the entry and size limits of `env`. `args` and `env` apply only to `command` servers, and `headers` only to `url` servers.
  - **Definitions:** `WorkflowModelAgentMcpServer` is a union of `WorkflowModelAgentStdioMcpServer` and `WorkflowModelAgentHttpMcpServer`. An http server keeps its header templates under `templates.headers`. `agentMcpServerValues(server)` returns the `env` or `headers` values and templates of either kind.
  - **Expressions:** the `agent.mcp_servers.headers.value` field accepts server and runner contexts.
  - **Materialized config:** `materializedAgentMcpServerSchema` accepts a stdio or an http server. A header value that reads a secret becomes a secret binding with the new `mcp_server_header` target.
  - **Regex:** `isHttpFieldName(value)` and `HTTP_FIELD_NAME_RE` check an HTTP header name.

- 9d7c039: Composite actions run. A composite step becomes a parent row that the server opens and closes, and its inner steps run in the calling job.

  - **Breaking:** sync always accepts composite actions, so the `compositeActionsEnabled` option of `fetchAndParseWorkflows` and `resolveDefinitionAtRef`, and the `compositeActions` option of `resolveWorkflowActions`, are gone. Inner reads of the composite's `inputs` fill when the step dispatches.
  - **Run model:** step rows gain `parent_step_id` and the `composite` type, and a step skipped because its composite did not run has the `composite_skipped` reason. Job executions store the `actions_dir` the setup step reports.
  - **Lifecycle:** opening a composite fills its `with` into typed inputs, and its `env` and working directory become the base of its inner steps, filled again each time it opens. Inner steps read the composite's `inputs`, their own `steps`, and `action.path`, and their `run_after` looks at earlier inner steps only. The composite closes as soon as its inner steps finish: it fails when one of them failed, and otherwise fills its outputs, keeping their types. Its gate then runs like any step's.
  - **Restarts:** a `restart_from` target is an earlier step of the same scope. A job step can restart a whole composite, which opens again with a new attempt.
  - **Sessions:** an agent session key inside a composite is scoped to the use, unless the key is exactly an input.
  - **Action files:** a runner step inside composite actions carries `action_bundles`, the digests of every composite that holds it. The action bundle route takes a `digest` query parameter and serves those bundles too. `actionBundleDirectoryName` in `@shipfox/workflow-document` names the directory a runner extracts a bundle into, which `action.path` points at.
  - **Routes:** `GET /workflows/runs/:id/action-snapshots/:digest/files/:path` returns a composite's manifest.
  - **DTOs:** step DTOs gain `parent_step_id`, the `composite` type, and `source_location.file`. The step report gains `actions_dir`.

- c0b814f: Accept a list of rules in `gate.on_failure` and an `if` condition on each rule. A single object stays valid as a one-rule list. Definitions validate each condition, feedback, and restart target at the path of its rule, reject a rule with no `if` that is not the last rule, and store `on_failure` as a rule list.
- 0654280: Expose the bounded `gate.on_failure.max_attempts` workflow authoring field and carry its effective value through Definitions normalization.
- f1f520f: Adds the job `container` field to the workflow document, and the `job.container.*` expression fields. The field is a string or an object with `image`, `credentials`, `env`, `options`, and `docker_socket`. `parseWorkflowDocument` rejects it unless `jobContainers` is set, and `buildWorkflowJsonSchema` leaves it out unless `containers` is set. The workflow model carries the normalized container, and snapshots that include one use version 5.
- ab66d1e: The job `container` field is now accepted by default. `parseWorkflowDocument` accepts it unless called with `{jobContainers: false}`, and `buildWorkflowJsonSchema` includes it unless called with `{containers: false}`. Both options defaulted to `false` before.
- e08530c: Launches concurrent steps. Workflows can use `background`, `wait`, `wait_all`, `cancel`, and `parallel`: definition sync, validation, and dev runs accept them, and the published `workflow.schema.json` describes them.
- 4e3497b: Lets an agent step `prompt` be a list of up to 64 parts. A part is a string or a `{file: ./path}` reference. The normalizer joins string parts with a blank line, and a string `prompt` is unchanged. A `file` part fails with `prompt-file-invalid` until prompt files are supported.
- d657853: Adds `run_after` to steps and jobs. Set it to `success`, `failure`, or `always` to choose when a step or job runs after an earlier failure. It defaults to `success`, and an `if` now adds to it instead of replacing it. Workflows stored before this change keep their current behavior until their file is next synced.
- cb411b1: Action steps can reference a registry version, such as `uses: shipfox/slack-thread-digest@1.4.2`. Registry references stay off by default.

  - **Opt-in:** `parseWorkflowDocument(input, {actions: true, registryActions: true})` accepts registry references. Without `registryActions`, every registry form still fails with "Remote actions are not supported yet". `workflowDocumentStepSchema` used directly accepts them.
  - **Grammar:** a reference is `namespace/name@MAJOR.MINOR.PATCH`. Namespaces and names are 2 to 40 lowercase letters, digits, and single hyphens. Ranges, tags, pre-release versions, and bare names fail with "Pin an exact version". A host such as `registry.acme.dev/...` fails with "Other registries are not supported yet", and `owner/repo/path@ref` fails with "Remote actions come from the registry, not from Git". Repository path forms keep their messages.
  - **Parsed reference:** `parseWorkflowActionRef(uses)` returns `{kind: 'local', path}` or `{kind: 'registry', namespace, name, version}`, or the message for an invalid value.
  - **Manifest:** `action.yml` accepts optional `keywords` (up to 10 slugs) and `related` (registry package names).

- 9906470: Adds `from_file` and `from_stdout` to run step output declarations. A run step can read an output from a file in the job workspace or from its standard output, up to 64 KiB, instead of writing to `$SHIPFOX_OUTPUT`. The run dispatch config carries them as `output_sources`.
- 2100749: Adds `continue_on_error` to steps. When such a step's own work fails, the step still ends `failed`, but its failure does not count for `run_after`, `execution.failed`, or the job result. Gate restarts run first, and the flag applies to the final failure. It does not cover a step that cannot start, such as an `if` that cannot be evaluated, or a job that times out.

  - **Workflow model:** a step carries `continueOnError: true` when set. A model with such a step is stored as snapshot version 7. Sync rejects the field on a step that uses a composite action.
  - **Storage:** the steps table gains `continue_on_error`, and step attempts gain `failure_ignored`.
  - **API:** the step status reason gains `failure_ignored`. Every step in a job detail carries `affects_job`, and an attempt that `continue_on_error` covered carries `failure_ignored: true`. The agent access read tools accept the new status reason.
  - **Run page and annotations:** an ignored failure shows as a warning, like a post with `post_failure: warn`, and its failure card is a warning. The job page opens on the first failure that counts.

- f6bc1f4: Adds `export` to run, agent, action, and tool steps. `export: true` promotes every declared output of the step to a job output of the same name, and `export: [names]` promotes the listed ones. A later job reads them with the usual types. Sync rejects an unknown name, a clash with the job `outputs` map, and two steps that export the same name. A job output exported from a step that did not produce it is omitted instead of failing the job.
- 651153a: Run and agent step output declarations accept a `default`. When a step has no value for an output, for example because it was skipped or its run step succeeded without writing it, later steps and job outputs read the default from `steps.<key>.outputs`. A default that does not match its declared type or `schema` fails sync. `steps.<key>.outputs` now reads the step's current attempt, so a step that a gate restart skips on the rerun no longer shows the previous pass's values, and it is `{}` before the step's first attempt finishes.
- dbe45d5: Adds the action bundle codec. `encodeActionBundle` writes the files of an action directory as canonical JSON with a `sha256:<hex>` digest and a gzipped stored form, and `decodeActionBundle` reads it back after checking the digest.

  Definitions stores action snapshots per workspace and digest, and the new `getActionSnapshot` inter-module method returns the manifest, the gzipped bundle as base64, and the byte length of the uncompressed bundle, or the `action-snapshot-not-found` known error.

- 0b661c9: Adds `parseAnchoredPattern(line)`, which reads a cache path or `hashFiles` pattern without Node imports, so the API and the runner accept the same patterns.

  - **Result:** `{ok: true, anchor, pattern}`, with `anchor` `cwd`, `home` for `~/`, or `root` for `/`, and the pattern normalized relative to it. A bad line returns `{ok: false, reason}`, where `reason` is `empty`, `control-character`, `whole-anchor`, or `leaves-anchor`.
  - **Normalization** matches `posix.normalize` from `node:path` for relative paths.
  - **Entry:** the package root exports it, and `@shipfox/workflow-document/anchored-path` exports it without loading the workflow schemas.

- e71cded: Accepts top-level workflow `outputs`. The document schema takes a map from output names to templates, with the job-outputs entry limit. The new `workflow.outputs` expression field reads the `jobs`, `inputs`, `vars`, `workflow`, `run`, `trigger`, and `event` contexts. Definitions normalize the map into `WorkflowModel.outputs` and `outputTypes` and type-check each output against the declared job outputs, so a reference to an undeclared job output is a sync error. The workflow outputs runtime now evaluates under the `workflow.outputs` field.

### Patch Changes

- dc2bd62: Agent steps read the files of mainstream coding agents (Claude Code, Codex, OpenCode, Cursor, and pi) in the repository and in the runner home directory. `AGENT_REPOSITORY_SKILL_DIRECTORIES` adds `.pi/skills`, `.opencode/skills`, and `.cursor/skills`. The new `AGENT_HOME_SKILL_DIRECTORIES` lists the user skill directories, and the new `AGENT_HOME_INSTRUCTION_FILE_PATHS` lists the global instruction files for each harness, in the order the runner tries them. The `Repository context` session row now names the directory of each skill, for example `Skills: review (.agents/skills); tdd (~/.agents/skills).`
- d273097: The checkout step `path` description now says `path` is required unless the checkout owns the job root.
- e087b95: The checkout step and job `checkout` schema descriptions now state how a first-step checkout's `path` and the job `checkout` option decide which repository holds the job root.
- cfd75e4: Points the `gate.success` field description at the renamed feedback-loops docs section.
- Updated dependencies [8937e15]
  - @shipfox/regex@0.4.0

## 3.10.0

### Minor Changes

- 3494bf1: Adds a `default` thinking option that requests the provider default without applying workspace or deployment overrides.

## 3.9.0

### Minor Changes

- bcd9232: Adds reference-based secret defaults to workflow triggers and pins them when runs start.

### Patch Changes

- 17d86bf: The `integrations` step field description links to the integrations concept page.
- bd03ee1: The workflow schema now describes environment scope and workflow fields more clearly.

## 3.8.0

### Minor Changes

- f571b7f: Adds top-level workflow `concurrency` with required `group`. `scope` defaults to `workflow`, and `cancel_in_progress` defaults to `false`. Definitions warns when group roots may be unavailable and rejects unsupported policies.

## 3.7.0

### Minor Changes

- d559bdb: Persist the effective gate attempt limit for each run, defaulting new Definitions to five while retaining the legacy three-attempt fallback for older run data.

## 3.6.0

### Minor Changes

- 33f575e: Workflows honors materialized gate limits from 1 through 1,000 with WORKFLOW_GATE_MAX_ATTEMPTS_MAX and preserves the three-attempt behavior when the limit is absent.

## 3.5.0

### Minor Changes

- e225f5e: Adds strict direct integration-tool surfaces and explicit discovery mode to Pi workflow configuration.

## 3.4.0

### Minor Changes

- 46ae6a8: Enables authoring integration tool steps with literal tool references, JSON inputs, and result output mappings.

## 3.3.2

### Patch Changes

- b416c4c: Preserves existing package behavior while simplifying internal control flow.

## 3.3.1

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

- be5fb95: Upgrade Pi to 0.84.2, refresh its supported provider catalog and flagship defaults, expose current direct Anthropic models to the Claude harness, and allow Pi workflow steps to use `thinking: max`.

## 3.3.0

### Minor Changes

- 117edfd: Adds named agent sessions with validated keys and resume or fork modes.

## 3.2.0

### Minor Changes

- 0b6addb: Adds reserved tool step fields (`tool`, `connection`, `with`, and the expression `outputs` mapping form) to the workflow document schema, with `with` size and depth limits. The schema rejects steps that use them for now.

## 3.1.0

### Minor Changes

- 4f30864: Trigger `event` is now optional end to end. An omitted event subscribes to every event from its source. Explicit events continue to work unchanged. Built-in manual and scheduled triggers use `fire` and `tick`, respectively.

## 3.0.1

### Patch Changes

- ce0984d: Preserve structured values when jobs map typed step outputs, normalize them for JSON persistence, and bound materialized job output sizes and entry counts.

## 3.0.0

### Major Changes

- adf07e7: Cut over workflow and job display names to literal-only `name` fields, with runtime interpolation supported through `run_name` and `execution_name`.

### Minor Changes

- ee2ce67: Accept a `${{ }}` interpolation in an agent step's `thinking` field. The schema
  still offers the per-harness enum for editor completion, and the dispatcher
  checks the resolved value against the harness levels. An unsupported
  resolved level fails the step.
- e95fdf4: Add checkout target fields, checkout opt-out, and checkout steps to the workflow document schema.
- 3f781ee: Add workflow run and job execution naming fields to the authoring, expression, and normalized definition contracts.
- 032d316: Scope checkout credential minting to the currently running checkout step and return its fetch depth.
- c2a8e54: Normalize checkout target fields for step-dispatch resolution, reject unsupported job-level checkout fields, and keep the workflow model and runtime checkout contracts aligned.
- 7f90b0c: Add `working_directory` to the workflow-document schema for run and agent steps.

## 2.1.3

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.

## 2.1.2

### Patch Changes

- 8436596: Adds Dependency Cruiser checks to all classified API packages so source-edge enforcement remains active after retiring the duplicate import scan.
- 475ce59: Republishes all public packages after restoring release authorization.

## 2.1.1

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 2.1.0

### Minor Changes

- 7ce5c9e: Adds generated JSON Schema metadata for Shipfox workflow documents.

## 2.0.1

### Patch Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

## 2.0.0

### Major Changes

- 78527ce: Removes per-integration repository allowlists from agent workflow documents.

### Minor Changes

- 9086e65: Adds agent-step integration tool selection to the workflow document schema with method-aware include and exclude shapes.
- 7ca4c65: Adds step-level agent tool selection to the workflow document contract with shared harness tool deployment helpers.
- e9056c7: Adds workflow, job, and run-step env declarations for non-secret run-step configuration.
- 8e9c6cb: Adds per-harness agent thinking schemas and exports helpers for resolving supported thinking levels by harness.
- 3afb7e3: Adds job execution success expressions and execution timeouts to workflow documents.
  Renames job execution IDs in auth, runner, workflow, and timeout event contracts to the explicit `jobExecutionId` / `job_execution_id` shape.
- eb7d5e8: Adds step gates with `success_if` and `on_failure` to the workflow document shape.
- e87731a: Adds the agent step harness selector and updates the default agent thinking level to xhigh.
- f85b223: Moves trigger source-specific authoring fields into per-source config blocks so cron triggers use `config.schedule` and `config.timezone`.
- f0afdf8: Renames the step gate predicate from `success_if` to `success` and the restart payload from `on_failure.output` to `on_failure.feedback` across workflow authoring and predicate planning.
- 69d02e5: Adds job-level checkout permissions and persist-credentials fields to workflow documents.
- f63c6b0: Adds a shared workflow document package with a Zod contract and typed invalid-document error.
- 30d1c82: Adds workflow env size limits with exported constants and author-facing validation errors.
- ef1e917: Adds listening-job authoring fields and trusted execution context validation for listening jobs.
  Separates workflow identifiers so internal rows use UUID `id`, authored workflow/job/step
  references use `key`, and UI labels use `name`.
- a314b05: Adds workflow job output mapping support with execution-resolution interpolation planning.
- f88aac9: Allows workflow agent steps to omit model, provider, and thinking while requiring only prompt.
- a856155: Adds typed workflow output declarations and expression overlays for validating downstream output references.

### Patch Changes

- eb40964: Add an inline `agent` workflow step that the runner runs with the pi harness. A step is an agent step when it carries `model` + `prompt` and no `run`; it takes a free-text `model`, a single `prompt`, and an optional `thinking` level (default `high`). The step runs to process-success (the agent ran to completion) and reports through the existing step protocol with no runner/backend protocol change, so change quality is judged by a downstream `run` + `gate` step. v1 does not persist the agent's work (no diff, commit, or PR).
- e7b01dd: Adds the conditional workflow context surface and document fields for persisted if predicates.
- b525dcd: Let an agent workflow step pick its pi provider with an optional free-text `provider` field (default `anthropic`), threaded to the runner's pi model lookup, and split agent-step failures into a user-fixable `agent_config_invalid` reason (unknown provider, missing runner credentials, wrong provider/model pair) versus `agent_invocation_failed` for genuine provider/API errors.
- 9a5aac4: Adds cron trigger schedule and timezone fields with source-specific document validation.
