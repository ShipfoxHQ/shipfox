# @shipfox/expression

## 2.12.0

### Minor Changes

- af3b91f: Adds the `action.with` interpolation field for action step inputs. Like `tool.with`, it resolves at step dispatch. Unlike `tool.with`, it also accepts bare `secrets` references, which the runner fills.
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

- 476e3b1: An `action.yml` can set `steps` instead of `main` to declare a composite action. Sync expands it into the definition model.

  - **Breaking:** `ActionManifest` is now a union of a JavaScript and a composite manifest, so `main` can be `undefined`. Narrow it with `isCompositeActionManifest`. `actionManifestSchema` is a transform, so it no longer exposes `.shape` or `.extend`.
  - **Manifest:** a composite manifest sets `steps` instead of `main`, and has no `runtime`, `post`, or `post_failure`. Its outputs need `value`, and its inputs can set `secret: true`. Inner steps reject `checkout` and `export`, and a tool step needs `connection`. `uses:` and prompt `file:` accept a leading `${{ action.path }}/`. `safeParseActionManifest` rejects composite manifests unless `compositeActions` is set.
  - **Expressions:** `action` is a reserved root, readable only inside a composite action. `buildCompositeScopeEnvironment` types its inner `inputs` and `action`, and `action.outputs` is the field for an output `value`.
  - **Resolution:** composite actions are resolved recursively, at most 5 levels deep. A cycle fails with the new `action-cycle` sync error code, and deeper nesting with `action-nesting-too-deep`. The 20-action limit counts the whole tree, and the content hash covers every action and prompt file in it.
  - **Workflow model:** a `composite` step holds its inner steps, with path ids, scoped `inputs` and `steps`, secret inputs rewritten to the caller's references, and aliases bound to the caller's connections. A nested grant must fit inside its outer alias. Source locations can name the composite file. Snapshots with a composite step use version 6, and `flattenJobSteps` lists a job's steps in run order.

- 0b661c9: Adds the `runner` context and the `hashFiles()` function to workflow expressions.

  - **`runner` context:** `runner.os` and `runner.arch` are a typed server context available at `step-dispatch`, and `step.if` can read it. The root is no longer in `workflowContextReservedRoots`. A context definition can set `lastSite`, after which `rootsAvailableAt` and `unavailableRootsAt` treat it as unavailable; `runner` sets it to `step-dispatch`. `resolveContextRootLastSite` reads it.
  - **`hashFiles()`:** declared for type checks with 1 to 16 string patterns (`HASH_FILES_MAX_PATTERNS`). Planning routes a call to `runner-fill` and records `runnerCall: {function, patterns}` on the deferred segment. `analyzeRunnerCalls` and `referencesRunnerCall` find calls.
  - **Plan violations:** `planInterpolationField` reports `runner-call-not-bare`, `runner-call-argument-not-literal`, `runner-call-arity`, `runner-call-in-field`, `runner-call-pattern-invalid`, and `runner-call-pattern-outside-workspace`. Only fields with `acceptsRunnerCalls` (`run`, `env.value`, and `action.with`) accept a call. `validateServerEvaluable` reports `runner-call-in-server-expression`.

- 39c5466: A failed step keeps the outputs it set, typed by their declarations. Values that do not match their declaration are dropped.
- f1f520f: Adds the job `container` field to the workflow document, and the `job.container.*` expression fields. The field is a string or an object with `image`, `credentials`, `env`, `options`, and `docker_socket`. `parseWorkflowDocument` rejects it unless `jobContainers` is set, and `buildWorkflowJsonSchema` leaves it out unless `containers` is set. The workflow model carries the normalized container, and snapshots that include one use version 5.
- ecc70c2: A step or job `if` condition that cannot be evaluated now records the error in its evaluation trace, with the missing path and the status of the step or job it reads. The run UI says which value is missing and why. A step that has not run exposes empty `outputs`, so `has(steps.x.outputs.y)` returns `false` instead of failing.
- e40ec8b: Adds an optional `required` flag to step output declarations. When a declaration sets `required: false`, `coerceStepOutputs` accepts a result without that output and still type-checks the value when it is present. Declarations without the flag stay required. Expressions can check an optional output with `has()`. Reading an absent output raises the existing missing-path error.

  The workflows step reader now keeps `required` when it reads output declarations from step config.

- c6f2ae3: `checkRunReadiness` now reports `agent-config-invalid` for an agent step whose model, provider or thinking level the agent module refuses. It checks only steps whose `model`, `provider` and `thinking` are literal or absent, so a templated value never produces an issue. An absent value falls back to the workspace defaults. The issue blocks the start for a normal job, and fails the job when the job is listening or the session key is filled after run creation. The readiness route returns the new issue with its `reason`, `model` and `provider`. `@shipfox/expression` exports `shouldFillAtSite`.
- 9906470: Adds `from_file` and `from_stdout` to run step output declarations. A run step can read an output from a file in the job workspace or from its standard output, up to 64 KiB, instead of writing to `$SHIPFOX_OUTPUT`. The run dispatch config carries them as `output_sources`.
- 42829e8: Rejects a step `if` that reads `execution.failed` unless the step sets `run_after: always`, and exports `referencesExecutionFailed` from `@shipfox/expression`. The shipped templates now use `run_after` for their failure handlers and drop the `!execution.failed` and `needs.all(n, n.status == "succeeded")` guards it makes redundant.
- 96ac908: Adds `log_path` to `steps.<key>`, `steps.<key>.attempts[]`, and `step.restart.from` in workflow expressions, and rejects it in job outputs, workflow outputs, and `tool` step inputs.
- 651153a: Run and agent step output declarations accept a `default`. When a step has no value for an output, for example because it was skipped or its run step succeeded without writing it, later steps and job outputs read the default from `steps.<key>.outputs`. A default that does not match its declared type or `schema` fails sync. `steps.<key>.outputs` now reads the step's current attempt, so a step that a gate restart skips on the rerun no longer shows the previous pass's values, and it is `{}` before the step's first attempt finishes.
- 3c8db4c: The gate of a tool step can read `step.error`, with the `code` and optional provider `status` of a failed tool call, or null when the call did not fail. A gate can accept an expected failure and tell a missing object from an outage.
- e71cded: Accepts top-level workflow `outputs`. The document schema takes a map from output names to templates, with the job-outputs entry limit. The new `workflow.outputs` expression field reads the `jobs`, `inputs`, `vars`, `workflow`, `run`, `trigger`, and `event` contexts. Definitions normalize the map into `WorkflowModel.outputs` and `outputTypes` and type-check each output against the declared job outputs, so a reference to an undeclared job output is a sync error. The workflow outputs runtime now evaluates under the `workflow.outputs` field.
- 2ab4025: Workflows can link to their runs. `run.url` in the run context, `event.run.url` on Shipfox run and job events, and `url` on the `start_workflow_run` output hold the run permalink, built from `CLIENT_BASE_URL`. Replaying a Shipfox event stored without `run.url` fills it in. The `slack-dispatcher` and `report-failed-runs` templates use these links instead of `https://app.shipfox.io/runs/`.

### Patch Changes

- 3b63397: An out-of-range list index error no longer reports the list size, and reports the index only when the expression writes it as an integer literal. A computed index, such as `event.values[int(event.position)]`, now produces an `evaluation-error` detail with the `index_out_of_bounds` classification, and a summary without numbers.
- b76c004: Correctly infers mapped expressions as lists and preserves their element types, allowing list outputs to validate against their JSON Schemas.
- 0b2af13: Tool step outputs keep JSON-looking strings as strings instead of parsing them into numbers or booleans.
- Updated dependencies [be33fe6]
- Updated dependencies [6b4ae32]
- Updated dependencies [7d20d04]
- Updated dependencies [dc2bd62]
- Updated dependencies [3f1363c]
- Updated dependencies [8937e15]
- Updated dependencies [d273097]
- Updated dependencies [e087b95]
- Updated dependencies [476e3b1]
- Updated dependencies [9d7c039]
- Updated dependencies [c0b814f]
- Updated dependencies [0654280]
- Updated dependencies [cfd75e4]
- Updated dependencies [f1f520f]
- Updated dependencies [cfe6ce6]
- Updated dependencies [ab66d1e]
- Updated dependencies [67e55ea]
- Updated dependencies [e08530c]
- Updated dependencies [4e3497b]
- Updated dependencies [d657853]
- Updated dependencies [cb411b1]
- Updated dependencies [9906470]
- Updated dependencies [2100749]
- Updated dependencies [f6bc1f4]
- Updated dependencies [651153a]
- Updated dependencies [dbe45d5]
- Updated dependencies [0b661c9]
- Updated dependencies [e71cded]
  - @shipfox/workflow-document@4.0.0

## 2.11.2

### Patch Changes

- Updated dependencies [3494bf1]
  - @shipfox/workflow-document@3.10.0

## 2.11.1

### Patch Changes

- 07ca907: The `vars` and `secrets` context notes link to the secrets and variables guide.
- Updated dependencies [17d86bf]
- Updated dependencies [bcd9232]
- Updated dependencies [bd03ee1]
  - @shipfox/workflow-document@3.9.0

## 2.11.0

### Minor Changes

- 92b30aa: Adds concurrency group expressions to the shared workflow context registry and keeps definition validation and generated reference documentation aligned.

## 2.10.1

### Patch Changes

- Updated dependencies [f571b7f]
  - @shipfox/workflow-document@3.8.0

## 2.10.0

### Minor Changes

- ec852c4: Expose the authored restarting gate key on `step.restart.from` for dispatch-time workflow expressions.

## 2.9.2

### Patch Changes

- 0c00509: Preserves early workflow context values in staged tool inputs.

## 2.9.1

### Patch Changes

- Updated dependencies [d559bdb]
  - @shipfox/workflow-document@3.7.0

## 2.9.0

### Minor Changes

- 10f23f7: Detects historical workflow event-payload dependencies and reports listener batch partition warnings.

### Patch Changes

- Updated dependencies [33f575e]
  - @shipfox/workflow-document@3.6.0

## 2.8.0

### Minor Changes

- bd5acd2: Bounds listener filter snapshots to referenced context paths and a separate 512 KiB `filter_snapshot` execution payload limit.

### Patch Changes

- @shipfox/workflow-document@3.5.0

## 2.7.0

### Minor Changes

- 351569e: Exposes the current workflow run attempt as `run.attempt` in expressions and reruns. Deploy compatible workers before adopting this field in persisted expressions because older builds omit it and cause those expressions to fail closed.
- 41e1cfc: Surfaces precise, safe trigger event errors in the event detail callout.

## 2.6.1

### Patch Changes

- 8825c23: Bounds evaluation traces to stay within the observation size budget while keeping deterministic prefixes and accurate dropped-entry counts.
- Updated dependencies [e225f5e]
  - @shipfox/workflow-document@3.5.0

## 2.6.0

### Minor Changes

- 813a284: Adds CEL `dyn` support for unknown-shaped tool and JSON outputs, preserves their native runtime values, and keeps listener snapshots compatible during rolling deploys.

## 2.5.0

### Minor Changes

- eb45f1d: Exposes bounded CEL evaluation diagnostics without runtime operands.

### Patch Changes

- 646373f: Accept dynamic predicate results at sync and surface an evaluation_error when a predicate does not evaluate to a boolean.

## 2.4.3

### Patch Changes

- Updated dependencies [46ae6a8]
  - @shipfox/workflow-document@3.4.0

## 2.4.2

### Patch Changes

- b416c4c: Preserves existing package behavior while simplifying internal control flow.
- Updated dependencies [b416c4c]
  - @shipfox/workflow-document@3.3.2

## 2.4.1

### Patch Changes

- Updated dependencies [9fdba44]
- Updated dependencies [be5fb95]
  - @shipfox/workflow-document@3.3.1

## 2.4.0

### Minor Changes

- 117edfd: Adds named agent sessions with validated keys and resume or fork modes.

### Patch Changes

- Updated dependencies [117edfd]
  - @shipfox/workflow-document@3.3.0

## 2.3.0

### Minor Changes

- b7d522a: Adds `list.first()` and `list.last()` to return the first or final element of a non-empty workflow expression list.
- 050b796: Adds typed tool-step expression contexts, result-output mappings, and reserved-root validation.

### Patch Changes

- Updated dependencies [0b6addb]
  - @shipfox/workflow-document@3.2.0

## 2.2.1

### Patch Changes

- Updated dependencies [4f30864]
  - @shipfox/workflow-document@3.1.0

## 2.2.0

### Minor Changes

- 3e7fe76: Adds shared `range()`, `toJson()`, and `fromJson()` functions to workflow expressions.

## 2.1.0

### Minor Changes

- ce0984d: Preserve structured values when jobs map typed step outputs, normalize them for JSON persistence, and bound materialized job output sizes and entry counts.

### Patch Changes

- Updated dependencies [ce0984d]
  - @shipfox/workflow-document@3.0.1

## 2.0.0

### Major Changes

- 7c4116e: Align predicate property types with their runtime shapes, replace `run.run_name` with `run.workflow_name`, and remove `failed` from `executions` entries.
- 045895c: Remove the unused workflow context trust metadata and related public exports. Allow
  external context in agent model and provider interpolations now that interpolation
  fields no longer enforce source tiers.
- adf07e7: Cut over workflow and job display names to literal-only `name` fields, with runtime interpolation supported through `run_name` and `execution_name`.
- ee2ce67: Split workflow definition facts out of the `run` context into a `workflow` root.
  `run.workflow_name` becomes `workflow.name` and `run.definition_id` becomes
  `workflow.id`, so `workflow` and `run` mirror the `job` and `execution` pair.
  Add `contextRootsForField` to return the readable roots for a predicate or an
  interpolation field without requiring the caller to choose a mechanism. Add
  `workflowContextDocs` as the reader-facing description of every root and property.

### Minor Changes

- dea1ffd: Expose normalized repository references on listening execution events.
- 3f781ee: Add workflow run and job execution naming fields to the authoring, expression, and normalized definition contracts.
- 285fff2: Persist resolved workflow job execution names and handle dynamic naming failures consistently.
- 4d246d4: Align predicate validation and runtime evaluation with field-specific context contracts.
- d77baaa: Add per-definition sequential numbers to workflow runs and expose them in the API and expression context.
- 41d558c: Add a pure shell code-position classifier for detecting workflow data passed to commands that re-evaluate their arguments.
- c2a8e54: Normalize checkout target fields for step-dispatch resolution, reject unsupported job-level checkout fields, and keep the workflow model and runtime checkout contracts aligned.
- cb0abfa: Expose the normalized trigger project, repository, ref, and commit in workflow context.

### Patch Changes

- 3d91d1d: Allow workflow context roots in interpolatable fields while preserving host and availability validation. Keep model and provider selection restricted to workflow-authored context so external payloads and step outputs cannot steer agent execution.
- 4444079: Warn when shell positions re-execute workflow-controlled values as code.
- Updated dependencies [ee2ce67]
- Updated dependencies [e95fdf4]
- Updated dependencies [adf07e7]
- Updated dependencies [3f781ee]
- Updated dependencies [032d316]
- Updated dependencies [c2a8e54]
- Updated dependencies [7f90b0c]
  - @shipfox/workflow-document@3.0.0

## 1.2.1

### Patch Changes

- 71d9ba4: Accepts integer literals in CEL equality checks against numeric workflow values.

## 1.2.0

### Minor Changes

- a713231: Add scoped CEL environments, a per-evaluation inclusive `range` primitive capped at 1,000 values, and typed exact-expression field resolution for config templating.

### Patch Changes

- @shipfox/workflow-document@2.1.3

## 1.1.5

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/workflow-document@2.1.3

## 1.1.4

### Patch Changes

- 8436596: Adds Dependency Cruiser checks to all classified API packages so source-edge enforcement remains active after retiring the duplicate import scan.
- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [8436596]
- Updated dependencies [475ce59]
  - @shipfox/workflow-document@2.1.2

## 1.1.3

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/workflow-document@2.1.1

## 1.1.2

### Patch Changes

- 7a71e7d: Aligns published dependency ranges with the workspace catalog policy.
- Updated dependencies [7ce5c9e]
  - @shipfox/workflow-document@2.1.0

## 1.1.1

### Patch Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.
- Updated dependencies [1b0d344]
  - @shipfox/workflow-document@2.0.1

## 1.1.0

### Minor Changes

- 7bc7498: Adds job runner as a server-side interpolation field for execution-level runner selection.
- 26fea4b: Adds the authorable `steps` workflow context root and a shared field resolver for preserving residual interpolation plans.
- 0cf66c4: Adds ingest-time predicate foundations with filter predicate fields and boolean-shape detection.
- 8f51daf: Adds workflow template parsing with expression segments and conservative CEL root extraction for downstream interpolation checks.
- e689abf: Adds the v1 workflow context registry and interpolation field policies for typed, trust-tiered workflow interpolation.
- ce3e5ca: Adds residual workflow expression planning APIs for deferred field segments, runner-fill validation, server-evaluability checks, and monotone site fills.
- cdf8989: Adds shared CEL expression checks and evaluation behind Shipfox-owned APIs.
- 1127ba2: Adds safe run-command interpolation by hoisting resolved values into generated environment variables.
- 36f871d: Adds evaluation trace helpers for recording resolved workflow expressions with capped values and secret references.
- d546b88: Adds declared workflow field failure policies and a shared fail-closed predicate evaluator.
- 998eba3: Adds phase-aware workflow context metadata, availability predicates, and creation-phase workflow context assembly for runtime materialization.
- 5d53ed4: Adds workflow expression support for vars and runner-host secret contexts with literal-key validation.
- f0afdf8: Renames the step gate predicate from `success_if` to `success` and the restart payload from `on_failure.output` to `on_failure.feedback` across workflow authoring and predicate planning.
- 9d3b43a: Adds expected result type validation for typed workflow expressions.
- d635979: Routes workflow materialization and predicate evaluation through persisted planner segments, replacing resolver exports with planned freeze APIs.
- e0fee57: Promotes workflow jobs context and expands execution and step self-root expression shapes for workflow output references.
- fa67aa3: Reject workflow definitions whose step run/env/agent/name interpolation references a context root not yet available at that field's fill site, with a message naming when the root becomes available.
- ef1e917: Adds listening-job authoring fields and trusted execution context validation for listening jobs.
  Separates workflow identifiers so internal rows use UUID `id`, authored workflow/job/step
  references use `key`, and UI labels use `name`.
- 51eb38a: Adds the step.feedback interpolation field for server-side gate feedback templates.
- e2fbef8: Adds an open-map expression type so workflow predicates can type-check dynamic step output fields.
- 2ad300c: Adds typed step output coercion helpers for validating reported workflow outputs against declarations.
- a314b05: Adds workflow job output mapping support with execution-resolution interpolation planning.
- 1ea2f6a: Renames workflow context phases to availability sites, reshapes reserved roots, and adds sensitivity, host, and fill-target exports for planner context assembly.
- ad6056b: Adds workflow template resolution with string coercion, missing-path diagnostics, and typed evaluation failures.
- a856155: Adds typed workflow output declarations and expression overlays for validating downstream output references.

### Patch Changes

- e7b01dd: Adds the conditional workflow context surface and document fields for persisted if predicates.
- 58c05ed: Removes the unused resolved-field fill primitive from the expression package surface.
- 950ebef: Fixes fail-policy freezing for reserved server roots such as steps, jobs, and matrix.
- e1d4972: Evaluate the step gate `success_if` over the `step` self-root (`step.exit_code`, `step.status`) and job `success` over the full typed executions context, both validated against the shared context registry; authored gate expressions move from `exit_code` to `step.exit_code` and job-success now fails closed on a runtime evaluation error.
- Updated dependencies [eb40964]
- Updated dependencies [e7b01dd]
- Updated dependencies [9086e65]
- Updated dependencies [7ca4c65]
- Updated dependencies [e9056c7]
- Updated dependencies [8e9c6cb]
- Updated dependencies [b525dcd]
- Updated dependencies [3afb7e3]
- Updated dependencies [eb7d5e8]
- Updated dependencies [e87731a]
- Updated dependencies [f85b223]
- Updated dependencies [f0afdf8]
- Updated dependencies [69d02e5]
- Updated dependencies [f63c6b0]
- Updated dependencies [9a5aac4]
- Updated dependencies [30d1c82]
- Updated dependencies [ef1e917]
- Updated dependencies [a314b05]
- Updated dependencies [f88aac9]
- Updated dependencies [a856155]
- Updated dependencies [78527ce]
  - @shipfox/workflow-document@2.0.0
