# @shipfox/api-workflows-dto

## 34.0.0

### Minor Changes

- af0e24b: Shipfox runs the `post` entry of an action at the end of the job.

  - **Post rows:** a job execution gets one `post` step for each action step that declares `post`, after every authored step, in reverse step order. The row is named `Post <step name>`, has no key, and is skipped with the `main_not_started` reason when its main entry never reached the runner.
  - **Dispatch:** a post runs with the inputs, env, secret bindings, tool grants, state, and exported environment of the last attempt of its main step that reached the runner, also after a gate restart skipped the step.
  - **Job result:** a failed post with `post_failure: warn` leaves the job result and `execution.failed` unchanged. With `fail`, it fails the job.
  - **API:** the step type gains `post`, the step status reason gains `main_not_started`, and a post row in a step summary carries `main_step_id` and `affects_job`. The agent access read tools return the same.

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

- ba1aff7: Adds run-started and job-execution-started lifecycle event contracts.
- 2526ccf: Adds the Cache module and the routes a runner calls to save and restore a job cache. A save reserves a key, uploads the archive straight to object storage through signed part URLs, and commits. A restore finds the entry by exact key or restore key and signs a download URL. A dev run saves into a sandbox of the user who started it. The object store gains signed multipart uploads and a `publicEndpoint` option for signed URLs. The Workflows contract gains `getWorkflowRunOrigin`. Set `CACHE_STORAGE_S3_*` to give the cache its own bucket.
- c4f486b: Names the cause of a checkout failure. Each refusal now identifies the repository, connection or project it was about, a suspended or removed GitHub App installation has its own `installation-inactive` code, and GitHub's own explanation reaches the step error as `provider_message` and `provider_status`. A missing repository now returns a 422, and a failed token mint is cached for 60 seconds instead of 15 minutes.
- 9d7c039: Composite actions run. A composite step becomes a parent row that the server opens and closes, and its inner steps run in the calling job.

  - **Breaking:** sync always accepts composite actions, so the `compositeActionsEnabled` option of `fetchAndParseWorkflows` and `resolveDefinitionAtRef`, and the `compositeActions` option of `resolveWorkflowActions`, are gone. Inner reads of the composite's `inputs` fill when the step dispatches.
  - **Run model:** step rows gain `parent_step_id` and the `composite` type, and a step skipped because its composite did not run has the `composite_skipped` reason. Job executions store the `actions_dir` the setup step reports.
  - **Lifecycle:** opening a composite fills its `with` into typed inputs, and its `env` and working directory become the base of its inner steps, filled again each time it opens. Inner steps read the composite's `inputs`, their own `steps`, and `action.path`, and their `run_after` looks at earlier inner steps only. The composite closes as soon as its inner steps finish: it fails when one of them failed, and otherwise fills its outputs, keeping their types. Its gate then runs like any step's.
  - **Restarts:** a `restart_from` target is an earlier step of the same scope. A job step can restart a whole composite, which opens again with a new attempt.
  - **Sessions:** an agent session key inside a composite is scoped to the use, unless the key is exactly an input.
  - **Action files:** a runner step inside composite actions carries `action_bundles`, the digests of every composite that holds it. The action bundle route takes a `digest` query parameter and serves those bundles too. `actionBundleDirectoryName` in `@shipfox/workflow-document` names the directory a runner extracts a bundle into, which `action.path` points at.
  - **Routes:** `GET /workflows/runs/:id/action-snapshots/:digest/files/:path` returns a composite's manifest.
  - **DTOs:** step DTOs gain `parent_step_id`, the `composite` type, and `source_location.file`. The step report gains `actions_dir`.

- eb3f034: Step diagnostics name the composite actions that hold a step.

  - **Step attempt detail:** the response gains `parent_step_id` and `step_path`, the step's labels from its outermost composite down to the step, such as `["setup", "lint"]`. A label is the step key, or its name when it has no key.
  - **Stored step errors:** an `if` that cannot be evaluated and a failed background step name an inner step by its key path, such as `setup › lint`.
  - **Failure annotations:** an inner step reads as its key path, as on the run page. Job steps read as before.
  - **MCP:** `get_step_attempt` returns `parent_step_id` and `step_path`.
  - **Limits:** `MAX_ACTION_NESTING_DEPTH` and `MAX_STEP_PATH_LENGTH` are exported from `@shipfox/api-definitions-dto`.

- 2e5a311: Dev runs accept action uploads. `POST /dev-runs` and the `create_dev_run` MCP tool take an `actions` field: whole action directories, each replacing the ref's copy of its `uses` path. Both routes accept bodies up to 4 MiB. The `create_dev_run` description tells agents which files to send. The run DTO's `dev_source` gains `local_actions`, the uploaded action paths. It defaults to an empty list for older runs.
- b9a53b2: Adds `status_reason`, `status_reason_message`, and `outputs` to the run overview attempt. The `shipfox` provider's `get_workflow_run` tool returns them on its attempt, and the agent-access `get_workflow_run` tool returns them on the run.
- dc8065c: Fails a step or job when its `if` can't be evaluated, instead of skipping it. The step error reason is `condition_errored`, and the failure names the cause.
- 205afb5: A failed step attempt shows which `gate.on_failure` rule restarted the job, that no rule applied, or which rule could not be evaluated. The run page and the Agent Access step attempt tools return the same decision, and a step with a rule list shows the attempt limit of the rule its latest restart used. Agent Access no longer blanks the first root of an evaluation trace entry.
- a73e712: The integration tool gateway serves action steps as well as agent steps.

  - **Leased tool context:** `getLeasedAgentToolContext` keeps its name and accepts leased `action` steps. Other step types still fail with `leased-step-not-agent`. The result gains `stepType` (`agent` or `action`). For an action step, `integrations` holds the tools frozen at run creation, with one entry per connection, and each tool carries its `result` kind.
  - **Audit:** the tool call caller adds `action`, on both the audit line and the `integrations_agent_tool_call` metric label. When the runner sends `x-shipfox-call-id`, the audit line records it as `callId`.

- f769d90: Add the `image` tool result kind. A provider marks a tool that returns images with `result: 'image'`. An agent step can call it and receives the image blocks. A tool step that names it fails validation with `integration-tool-agent-only`, and an action cannot call it: the generated action tool types leave it out and the action endpoint refuses the call.
- 593142d: Adds `summary`, `job_key` and `step_index` to the step error. A `config_unresolvable` failure now names the field and reason, and the job and step when the failing field belongs to a step. The message no longer carries a definition id. The `get_step_attempt` MCP tool returns the same fields.
- f1f520f: Adds the job `container` field to the workflow document, and the `job.container.*` expression fields. The field is a string or an object with `image`, `credentials`, `env`, `options`, and `docker_socket`. `parseWorkflowDocument` rejects it unless `jobContainers` is set, and `buildWorkflowJsonSchema` leaves it out unless `containers` is set. The workflow model carries the normalized container, and snapshots that include one use version 5.
- ef7cf4a: Adds the `container_setup_failed` step error reason. The runner reports it when the setup step cannot pull or start the job container.
- f7e0fb7: Adds the `container_setup_failed` step error reason, which marks a failed job container pull or start as a setup failure. The agent access diagnostics accept the new reason. Secret bindings gain two targets for the setup step of a container job: `container_credential` for the registry username or password, and `container_env` for a container environment variable.
- fc455ac: Workflow runs materialize and dispatch action steps (`uses`). Definitions accept `uses` only while `DEFINITION_ACTIONS_ENABLED` is on, and it stays off in production for now.

  - **Step type:** steps gain the `action` type. The job detail and agent access step type enums accept it.
  - **Config:** an action step's config carries the action (`uses`, snapshot digest, `main`, and name), its `inputs`, the merged workflow, job, and step `env`, the connection binding of each integration alias, and the manifest outputs with `required`.
  - **Dispatch:** `with` values are completed at dispatch. Defaults fill omitted inputs, and each value is coerced to its declared type. A value that fails coercion fails the attempt with the new `action_input_invalid` reason.
  - **Error reasons:** `stepErrorReasonSchema` adds `action_input_invalid` (user) and `action_unavailable` (setup, for a runner that cannot load the action snapshot). The agent access diagnostics enum adds both.
  - **Interpolation fields:** the workflows and triggers inter-module error schemas accept `action.with`.
  - **Reruns** copy the attempt model, so they run the same action snapshot.
  - **Client:** the step error reason type accepts the two new reasons.

- 67e55ea: Models concurrent steps: the document fields, normalization, sync rules, and storage.

  **Breaking:** `WorkflowDocumentJob['steps']` now holds steps and `parallel` blocks, so code that reads `job.steps` as a list of steps must use `jobSteps(job)`. `WorkflowModelStep` gains the `wait` and `cancel` kinds, so a `switch` over `kind` must handle them.

  - **Document:** steps gain `background`, `wait`, `wait_all`, and `cancel`, and a job's `steps` can hold a `parallel` block of at least two steps. `jobSteps(job)` yields every step with its document path, `parallel` members included, and every walker over a job document now uses it, so a `uses:` or `prompt` file inside a block is still found. `job.steps` now also holds blocks. `workflowDocumentSchema`, `parseWorkflowDocument`, and `buildWorkflowJsonSchema` accept the five keys. `rawJobSteps(input)` walks the steps of a document that is not parsed yet.
  - **Workflow model:** steps gain `background`, `parallelGroup`, and `joinedAt`, plus `wait` and `cancel` step kinds. Normalization expands each `parallel` block into background steps followed by a wait, resolves `wait_all` to explicit targets, adds a closing wait when background steps are still running, and checks the order rules: a background step needs a `key`, takes no gate, and cannot overlap a `checkout`, a gate cannot restart past a running background step, and concurrent steps cannot share an agent session. A step reads a background step only after the wait that joins it. A model with a concurrent step is stored as snapshot version 8.
  - **Storage:** steps gain `background`, `parallel_group`, and `joined_at`, step attempts gain `cancel_requested_at`, and `wait` and `cancel` are step types. Dispatch context and `env_sources` skip a background step until a wait has joined it.
  - **API:** the step type of a job detail and of the agent access read tools can be `wait` or `cancel`.

- ecc70c2: A step or job `if` condition that cannot be evaluated now records the error in its evaluation trace, with the missing path and the status of the step or job it reads. The run UI says which value is missing and why. A step that has not run exposes empty `outputs`, so `has(steps.x.outputs.y)` returns `false` instead of failing.
- 6b01f3d: Names the missing variable and where it is read when a run cannot start. `InterpolationUnresolvableError` and the `interpolation-unresolvable` inter-module error carry optional `variableKey`, `jobKey` and `step`. Predicates report `job.if`, `job.success`, `job.listening.filter`, `step.if` and `step.gate.success` instead of `env`. The error message no longer suggests `has()` for a missing variable.
- a15e118: Lets a managed model provider refuse a model for one workspace at run time. A provider opts in by implementing `availability`, which returns the workspace's locked models. A locked model fails the step with a 422 `agent-model-unavailable` response and a policy notice. An error from `availability` returns a retryable 503. Credential renewal doesn't recheck, so a running step is never cut off. The stored step error carries the notice, and the model unavailable callout shows its message and required action. Providers without `availability` behave as before.
- 4aad893: Adds machine placement rules for installation provisioning. A policy can now pass `placement.resolve`, and a job that needs a reserved runner label but only matches refused templates fails within one poll with the new `runner_not_allowed` status reason and its notice. The client shows the notice and its action.
- eca4c27: Stops runs that check out the project's source while its connection is missing, disabled, or in error. Trigger starts and listening-job deliveries now fail with the `source-connection-unavailable` known error. Cron records an errored tick and sends no failure alerts, and the next tick after recovery starts a run. A manual fire returns 422.
- c6f2ae3: `checkRunReadiness` now reports `agent-config-invalid` for an agent step whose model, provider or thinking level the agent module refuses. It checks only steps whose `model`, `provider` and `thinking` are literal or absent, so a templated value never produces an issue. An absent value falls back to the workspace defaults. The issue blocks the start for a normal job, and fails the job when the job is listening or the session key is filled after run creation. The readiness route returns the new issue with its `reason`, `model` and `provider`. `@shipfox/expression` exports `shouldFillAtSite`.
- fafbe84: `checkRunReadiness` now reports `secret-missing` for a step secret that is defined at neither workspace nor project scope. It fails the job after the run starts, and never refuses the start. Each definition also lists the `secrets.inputs.*` it reads, so a trigger can compare them with its secret mappings.
- 737c625: Adds the `checkRunReadiness` inter-module operation, which reports the variables a workflow reads that are not defined at workspace or project scope. Each `variable-missing` issue says whether it blocks the run from starting or fails a job after the run starts, and where the variable is read.
- 507915a: A required action can carry an optional `intent`, and `REQUIRED_ACTION_INTENTS` lists the known values. `intent` names a behavior a composing application may provide in place of opening `url`, such as `contact-support`. `url` stays required as the fallback, and an unknown `intent` still parses.

  The admission denial contract, the HTTP 409 `required_action`, and the agent-access error details now keep `intent` when it is set.

- 2c36559: The `workflows.workflow_run_attempt.created` and `workflows.workflow_run.terminated` events carry the run `origin`, `dev` or `synced`, so consumers can tell dev runs from synced runs without reading the workflows tables. A rerun reports the origin of its source run. The field is optional because events written before this change don't have it.
- 395e11d: Schedules concurrent steps on the server and the runner.

  - **Protocol:** the `next` request takes an `in_flight` list of the step attempts the runner holds. Each `next` response carries `cancel_step_ids`, and a `step` response says whether it is `background`. A `report` accepts `cancelled` for an attempt that a `cancel` step is stopping, which confirms that its process exited. The step DTO and the job detail steps gain `background` and `parallel_group`.
  - **Scheduling:** a running background step lets later steps start, and any other running step blocks them. A `wait` step blocks until every step it names has ended, and it fails when one of them failed without `continue_on_error`. A `cancel` step stops running targets without waiting for them. A checkout, an action post, and a step whose earlier attempt is stopping wait until the stopped process is confirmed, and the job does not finish before that. A background step no longer counts for the job result.
  - **Limit:** `WORKFLOWS_MAX_CONCURRENT_STEPS` caps the steps of one job that run at the same time. The default is 20.
  - **Metrics:** adds the `workflows_step_cancelled` counter, labeled by `reason`.

- 94e77bc: Stores an optional runner-reported `log_path` on step attempts and exposes it in dispatch context when a finalized step log is available.
- 2100749: Adds `continue_on_error` to steps. When such a step's own work fails, the step still ends `failed`, but its failure does not count for `run_after`, `execution.failed`, or the job result. Gate restarts run first, and the flag applies to the final failure. It does not cover a step that cannot start, such as an `if` that cannot be evaluated, or a job that times out.

  - **Workflow model:** a step carries `continueOnError: true` when set. A model with such a step is stored as snapshot version 7. Sync rejects the field on a step that uses a composite action.
  - **Storage:** the steps table gains `continue_on_error`, and step attempts gain `failure_ignored`.
  - **API:** the step status reason gains `failure_ignored`. Every step in a job detail carries `affects_job`, and an attempt that `continue_on_error` covered carries `failure_ignored: true`. The agent access read tools accept the new status reason.
  - **Run page and annotations:** an ignored failure shows as a warning, like a post with `post_failure: warn`, and its failure card is a warning. The job page opens on the first failure that counts.

- 9bac67e: Run, action and agent steps dispatched to a runner carry `env_sources`: the earlier steps, in position order, whose current attempt the runner executed.
- dd20040: Names the cause of a refused start when an agent step's configuration cannot be used. The agent `agent-config-invalid` error carries a `reason` (`model-unknown`, `provider-unsupported`, `harness-unsupported`, `thinking-unsupported` or `workspace-providers-disabled`) with the `model` and `provider` where they apply. `agent-config-unresolvable` passes them on with the job and step, in the inter-module error, the 422 `details` (`reason`, `model`, `provider`, `job_key`, `step`) and the trigger diagnostic. Every new field is optional, so stored diagnostics still map.
- daf0208: Names the cause of a refused start when an integration connection or tool cannot be materialized. `agent-integration-materialization-failed` carries a `reason` (`connection-missing`, `connection-provider-mismatch`, `source-connection-missing`, `tool-unknown` or `no-tools-selected`) with the `connection` and `tool` where they apply, and the job and step it came from. They reach the inter-module error, the 422 `details` (`reason`, `connection`, `tool`, `job_key`, `step`) and the trigger diagnostic. Setup failures keep no reason. Every new field is optional, so stored diagnostics still map.
- 6b2a308: Adds the workflow outputs runtime. `WorkflowModel` gains optional `outputs` and `outputTypes`. When a run attempt succeeds, its outputs are evaluated with the job-output limits and stored on the attempt. An output that cannot be evaluated or is too large fails the attempt with the `output_invalid` or `output_too_large` status reason. The lifecycle event context returns `run.outputs`, and run creation errors can name the `workflow.outputs` field.
- 2ab4025: Workflows can link to their runs. `run.url` in the run context, `event.run.url` on Shipfox run and job events, and `url` on the `start_workflow_run` output hold the run permalink, built from `CLIENT_BASE_URL`. Replaying a Shipfox event stored without `run.url` fills it in. The `slack-dispatcher` and `report-failed-runs` templates use these links instead of `https://app.shipfox.io/runs/`.
- 0b661c9: Step dispatch fills the `runner` context and turns `hashFiles()` calls into runner bindings.

  - **`@shipfox/api-workflows-dto`:** adds `stepBindingSchema`, whose segments are `literal`, `secret`, or `hash_files` with its `patterns`. Step configs keep bindings under `secret_bindings`.
  - **`@shipfox/api-secrets-dto`:** exports `secretBindingLiteralSegmentSchema`, `secretBindingSecretSegmentSchema`, `secretBindingAnyTargetSchema`, and `SecretBindingTargetDto` so the step binding schema reuses them.
  - **`@shipfox/api-workflows`:** `nextStepForLeasedJobExecution` accepts a `runnerPlatform` loader, called once per request and only for a step that reads `runner`. An action input filled on the runner must be a string input, whether it reads a secret or calls `hashFiles()`.

### Patch Changes

- 3869c1d: Fail queued job executions that are not claimed before the configured queue timeout and start execution timeouts from the persisted claim timestamp.
- Updated dependencies [be33fe6]
- Updated dependencies [e99aa97]
- Updated dependencies [7d20d04]
- Updated dependencies [dc2bd62]
- Updated dependencies [3f1363c]
- Updated dependencies [8937e15]
- Updated dependencies [1f218c4]
- Updated dependencies [807ae57]
- Updated dependencies [4c789ca]
- Updated dependencies [68d6cd6]
- Updated dependencies [476e3b1]
- Updated dependencies [eb3f034]
- Updated dependencies [3b3e25c]
- Updated dependencies [fb79732]
- Updated dependencies [f05ecde]
- Updated dependencies [8a4f3d8]
- Updated dependencies [dcd0b79]
- Updated dependencies [f1f520f]
- Updated dependencies [f7e0fb7]
- Updated dependencies [8872f36]
- Updated dependencies [a99c11b]
- Updated dependencies [67e55ea]
- Updated dependencies [af3b91f]
- Updated dependencies [e560f69]
- Updated dependencies [a15e118]
- Updated dependencies [d657853]
- Updated dependencies [090d6a0]
- Updated dependencies [507915a]
- Updated dependencies [a429987]
- Updated dependencies [3f1363c]
- Updated dependencies [2100749]
- Updated dependencies [f6bc1f4]
- Updated dependencies [651153a]
- Updated dependencies [dbe45d5]
- Updated dependencies [dd20040]
- Updated dependencies [00dd046]
- Updated dependencies [6b2a308]
- Updated dependencies [0b661c9]
- Updated dependencies [70e6983]
  - @shipfox/api-definitions-dto@34.0.0
  - @shipfox/api-secrets-dto@34.0.0
  - @shipfox/api-agent-dto@34.0.0
  - @shipfox/policy-notice@0.1.0

## 33.0.0

### Patch Changes

- Updated dependencies [f24d9cd]
  - @shipfox/api-agent-dto@33.0.0

## 32.2.0

### Patch Changes

- Updated dependencies [3494bf1]
  - @shipfox/api-agent-dto@32.2.0
  - @shipfox/api-definitions-dto@32.2.0

## 32.1.0

### Patch Changes

- Updated dependencies [fd261c8]
  - @shipfox/api-agent-dto@32.1.0

## 32.0.0

### Minor Changes

- 212c6b6: Adds a shared tabbed inspector for workflow runs and job executions with compact summary facts and a simplified usage breakdown. The run overview DTO gains `secret_inputs`, which lists each secret input's name and source key but never its value. Adds `@shipfox/react-ui/inspector`: the inspector host, header, facts, tabs, and full-width sections with property rows, plus the `background-inspector-*` surface tokens.

### Patch Changes

- Updated dependencies [e87d5a9]
  - @shipfox/api-agent-dto@32.0.0

## 31.0.0

### Minor Changes

- bab2786: Expose configured runner catalog names through the workflows contract and API.

### Patch Changes

- Updated dependencies [792fc53]
- Updated dependencies [3633ccc]
- Updated dependencies [c5c7fa3]
- Updated dependencies [9e170c7]
- Updated dependencies [bcd9232]
  - @shipfox/api-agent-dto@31.0.0
  - @shipfox/api-secrets-dto@31.0.0
  - @shipfox/api-definitions-dto@31.0.0

## 30.0.0

### Minor Changes

- b734fcf: Store secret input references on workflow runs and expose them on run detail responses.

### Patch Changes

- Updated dependencies [c0c5653]
  - @shipfox/api-secrets-dto@30.0.0
  - @shipfox/api-definitions-dto@30.0.0

## 29.1.0

### Patch Changes

- Updated dependencies [d12820f]
  - @shipfox/api-agent-dto@29.1.0

## 29.0.0

### Major Changes

- e7a8fe4: Removes rerun concurrency confirmation and applies the current concurrency policy atomically when creating the next attempt.

### Patch Changes

- Updated dependencies [8e74f71]
- Updated dependencies [b891938]
  - @shipfox/annotations-dto@29.0.0
  - @shipfox/api-agent-dto@29.0.0
  - @shipfox/api-definitions-dto@29.0.0

## 28.0.0

### Minor Changes

- e8f0212: Adds the confirm_concurrency_impact request field and the concurrency-impact response with affected attempts and planned effects for workflow reruns.
- 7067bc3: Shows which workflow run started a child run in the run list and overview.

### Patch Changes

- d62e17e: Repairs drifted workflow concurrency state: releases claims left by finished runs, promotes waiting runs, cancels superseded attempts, and restarts orchestrations that never started.

## 27.2.0

### Minor Changes

- 6ad8c2e: `startDevRun` accepts an optional `devSource.definitionSource` (`'ref' | 'local'`, default `'ref'`), and dev-run sources expose `definition_source`, so callers can tell whether a workflow definition came from the repository at a ref or was sent in the request.
- 45cf692: Adds workflow run causation fields and fixed depth and tree-size limits for child runs.

### Patch Changes

- Updated dependencies [ef44a76]
- Updated dependencies [f5bc959]
  - @shipfox/api-definitions-dto@27.2.0

## 27.1.0

### Minor Changes

- e0b7bd1: Carries workflow lineage and name snapshots through job-execution and inference Usage records.

## 27.0.0

### Patch Changes

- Updated dependencies [45c9598]
  - @shipfox/api-agent-dto@27.0.0

## 26.1.0

### Minor Changes

- cb99d51: Exposes model stream recovery rows and provider-category failures across workflow, log, Agent Access, and client contracts.

### Patch Changes

- Updated dependencies [db12613]
  - @shipfox/api-definitions-dto@26.1.0

## 26.0.0

### Minor Changes

- da717b1: Exposes workflow concurrency state and affected run attempts through workflow run APIs.
- 5cb4279: Joins initial workflow runs to resolved concurrency groups with transactional claim admission, claim outbox events, and accurate concurrency-group interpolation errors.
- aafce80: The workflow run-attempt-created event now optionally carries `actorUserId`.

## 25.0.0

### Minor Changes

- 00e2ce4: Publish lease_expired, provider_lost, and lifecycle_violation as job execution status reasons; add the optional cause field and RunnerJobLossCauseDto/runnerJobLossCauseSchema to the lease-expired event, with runner_lost fallback when provider state is unavailable.
- 9e8b007: Adds an optional `gate_max_attempts` field to the compact step summary, and
  shows effective gate restart limits and chronological gate attempt numbers in
  workflow run details.

### Patch Changes

- Updated dependencies [701df29]
  - @shipfox/api-agent-dto@25.0.0

## 24.2.0

### Minor Changes

- 011d9ec: Adds workspace-scoped `cancelWorkflowRun` and `rerunWorkflowRun` commands: cancellation returns the run `id`, `currentAttempt`, and `status`, while rerun returns `id`, `attempt`, and `status`; both report attempt mismatches, cancellation rejects terminal runs, and rerun rejects non-terminal runs or failed-mode requests when there are no failed or cancelled jobs. `startRunFromTrigger` optionally reports `deduplicated` for an already-started run and surfaces workspace admission errors.
- 3cc2ffb: Propagates concurrency supersession through workflow termination events and runner shutdown reconciliation.
- 6100626: Adds stable gate failure reasons and restart diagnostics across workflow APIs, Agent Access, and the client.

### Patch Changes

- @shipfox/api-definitions-dto@24.2.0

## 24.1.1

### Patch Changes

- @shipfox/api-definitions-dto@24.1.1

## 24.1.0

### Minor Changes

- c730a68: Adds `timed_out` and `run_cancelled` log records, exposes terminal causes on step-attempt termination events, and renders timeout, cancellation, and runner loss distinctly.
- cdc9dfe: Adds the waiting workflow run status to DTO, database, server, and client contracts without producing it during run creation.

### Patch Changes

- Updated dependencies [d559bdb]
- Updated dependencies [34b5267]
  - @shipfox/api-definitions-dto@24.1.0
  - @shipfox/api-agent-dto@24.1.0

## 24.0.0

### Patch Changes

- @shipfox/api-definitions-dto@24.0.0
- @shipfox/api-agent-dto@24.0.0

## 23.0.0

### Minor Changes

- bd5acd2: Bounds listener filter snapshots to referenced context paths and a separate 512 KiB `filter_snapshot` execution payload limit.

### Patch Changes

- @shipfox/api-definitions-dto@23.0.0
- @shipfox/api-agent-dto@21.1.0
- @shipfox/annotations-dto@20.3.0
- @shipfox/inter-module@0.2.3

## 22.0.0

### Major Changes

- e390533: Removes the legacy `GET /workflows/runs/:id` detail route.
  It removes `workflowRunDetailResponseSchema`, `jobDtoSchema`, `jobExecutionDtoSchema`, and their public exports, including `workflowRunJobDetailDtoSchema`, `workflowRunJobExecutionDetailDtoSchema`, `workflowRunStepDetailDtoSchema`, `WorkflowRunJobDetailDto`, `WorkflowRunJobExecutionDetailDto`, and `WorkflowRunStepDetailDto`.
  It also removes `WORKFLOW_RUN_DETAIL_REQUEST_KIND_HEADER`, `WORKFLOW_RUN_DETAIL_REQUEST_KINDS`, `WorkflowRunDetailRequestKind`, `getWorkflowRunDetail`, `useWorkflowRunQuery`, `workflowRunQueryOptions`, and `WorkflowRunDetail` exports.
  Run-attempt lists now return `{items, next_cursor}` with a default limit of 25; run lists omit trigger payloads, inputs, and source snapshots.
  Run-list and job-detail display statuses now use API-provided bounded status fields.
  Consumers must migrate to bounded overviews, paginated job and attempt resources, and dedicated job or step-attempt detail reads.
  Direct HTTP consumers of the removed detail route receive 404 responses without a compatibility signal.

### Minor Changes

- c392dfb: Adds typed synthetic listener dispatch and shared payload limits for production-shaped E2E coverage.

## 21.2.0

### Minor Changes

- 1f2c634: Adds bounded workflow execution trigger-event list and detail reads with stable
  pagination and size-limited payload previews. Existing execution context reads
  continue to support historical executions.
- 12cc22e: Adds bounded Agent Access tools for workflow execution trigger-event diagnostics.

### Patch Changes

- 8407bd1: Rejects oversized listener fire deliveries without suppressing matching resolve events.
  - @shipfox/api-definitions-dto@21.2.0

## 21.1.0

### Minor Changes

- 01af160: Separates execution payload limits from diagnostic read limits and bounds oversized workflow failures.
- 8a98a87: Bounds workflow step-attempt detail responses and adds typed oversized-field reasons to step-attempt diagnostics.
- 6fac62f: Adds runner identity to the `runners.job.claimed` projection on `job_executions`, and adds `workspaceId`, `projectId`, `definitionId`, `jobKey`, `queuedAt`, `startedAt`, and runner identity to `workflows.job_execution.terminated` and `jobKey`, `definitionId`, and `runNumber` to `workflows.job_execution.queued`, so a consumer can build a complete usage record from a single event.

### Patch Changes

- Updated dependencies [f534da6]
  - @shipfox/api-agent-dto@21.1.0

## 21.0.0

### Minor Changes

- 12f7b10: Exposes bounded workflow-run diagnostics through the Workflows inter-module contract.
- cffa62d: Adds bounded workflow-run overviews with API-provided status, duration, and
  `has_started_job_execution`, plus pinned-attempt workspace navigation and
  attempt/source reads.
- b5d02d1: Adds renewable inference credential metadata, capability, and failure-reason contracts while preserving legacy behavior.

### Patch Changes

- 32e9fa0: Carries named agent sessions into failed-job reruns.
- Updated dependencies [ff45d70]
- Updated dependencies [e225f5e]
- Updated dependencies [b5d02d1]
  - @shipfox/api-agent-dto@21.0.0
  - @shipfox/api-definitions-dto@21.0.0

## 20.4.0

### Minor Changes

- 9a66057: Adds lazy source, execution-context, and step-diagnostic workflow APIs with bounded diagnostic reads and writes.

## 20.3.0

### Minor Changes

- 813a284: Adds CEL `dyn` support for unknown-shaped tool and JSON outputs, preserves their native runtime values, and keeps listener snapshots compatible during rolling deploys.

### Patch Changes

- Updated dependencies [47f6024]
- Updated dependencies [da6fbb8]
  - @shipfox/annotations-dto@20.3.0
  - @shipfox/api-definitions-dto@20.3.0

## 20.2.0

### Minor Changes

- ff63dcd: Adds the workflow-run annotations endpoint with job, execution, and step ancestry, plus the job-explanations endpoint for failed or skipped jobs without execution rows.
- 61f7b94: Adds bounded selected-job detail and cursor-paginated execution, step, and step-attempt API responses, and caps persisted error and gate text in workflow-run responses.

### Patch Changes

- Updated dependencies [ff63dcd]
  - @shipfox/annotations-dto@20.2.0
  - @shipfox/api-definitions-dto@20.2.0

## 20.1.0

### Minor Changes

- 6207ce3: Adds bounded workflow run overview and job-page APIs with capped execution counts and source-snapshot enforcement.
- 5efaf93: Allow workflow run detail URLs to resolve a single run selection from a deeply nested attempt, job, execution, or step ID without requiring the intermediate ancestry in the URL.

### Patch Changes

- Updated dependencies [6207ce3]
- Updated dependencies [3ec04b0]
  - @shipfox/api-definitions-dto@20.1.0
  - @shipfox/api-agent-dto@20.1.0

## 20.0.0

### Minor Changes

- fdfa0b2: Add the `WORKFLOW_RUN_DETAIL_REQUEST_KIND_HEADER` request-kind header and `WorkflowRunDetailRequestKind` type for workflow-run detail reads; client-workflows detail requests now send the request kind, which the API records as initial versus polling.
- af4a765: Add the workflow-run lineage head endpoint and opt-in cursor pagination for attempt history while preserving the legacy no-query response.
- 70f2eed: Adds checkout credential renewal to the setup checkout-token response via `refresh-at`/`on-rejection` renewal modes and accepts an optional `rejected_generation` when renewing.

### Patch Changes

- @shipfox/api-agent-dto@20.0.0
- @shipfox/api-definitions-dto@20.0.0

## 19.0.0

### Minor Changes

- 34ebe6a: Expose workspace-scoped workflow execution and annotation read contracts.
- 93918a4: Server workflow tool steps now return a `wait` protocol while a scheduled tool call is pending, and clients recognize the new `tool_error`, `tool_config_invalid`, and `invocation_interrupted` step error reasons.

### Patch Changes

- Updated dependencies [c07c8e2]
- Updated dependencies [b416c4c]
- Updated dependencies [5af8d52]
  - @shipfox/api-agent-dto@19.0.0
  - @shipfox/api-definitions-dto@19.0.0
  - @shipfox/inter-module@0.2.3

## 18.0.0

### Minor Changes

- 151f750: Claims agent sessions at step dispatch and carries the session descriptor:
  - Resolves the session key template at the step-dispatch context site with the same roots as the prompt and calls the agent-module `claimSession` before the step is handed to the runner. A `resume` claim that conflicts with a live attempt, a resolved harness that differs from the session's pinned harness, an invalid resolved key, or an unavailable session registry fails the attempt through the config-evaluation-failure path with one of the new step error reasons: `agent_session_key_invalid`, `agent_session_held`, `agent_session_harness_mismatch`, `agent_session_unavailable`.
  - Embeds the resolved session descriptor `{id, key, mode, segment}` in the step dispatch config and exposes it as a typed nullable `session` field on the step DTO; the attempt config records the descriptor for the UI and audits.

- b2aad90: Adds `generation` and `renewal` checkout-credential fields and `createCheckoutCredentials`, which accepts the frozen connection, stable repository ID, exact permissions, and rejected generation.
- a50e2dc: Expose the `cancellation_reason` field so consumers can distinguish user cancellation from maximum-duration timeouts.

### Patch Changes

- 242bd21: Classifies infrastructure step errors consistently across API and client workflows.
- Updated dependencies [a6f242c]
  - @shipfox/api-agent-dto@18.0.0

## 17.1.0

### Patch Changes

- Updated dependencies [fd6cee5]
  - @shipfox/api-agent-dto@17.1.0

## 17.0.0

### Minor Changes

- ed4981e: Adds the lease-authed agent session transcript transport: `GET /runs/jobs/current/steps/:stepId/session` returns the decrypted, still-gzipped head snapshot with manifest headers (or a 204 no-head marker), and `POST .../session?attempt=N&base_segment=S` commits segment `S + 1` under the claim/base CAS with idempotent-retry acks and 409 conflicts. The routes resolve the leased step through a new workflows inter-module method (`getLeasedAgentSessionContext`); the artifact store enforces the session blob cap.

### Patch Changes

- Updated dependencies [ed4981e]
- Updated dependencies [9f898d9]
- Updated dependencies [be5fb95]
  - @shipfox/api-agent-dto@17.0.0
  - @shipfox/api-definitions-dto@17.0.0

## 16.1.0

### Minor Changes

- d1fb0a3: Adds the agent session claim and carry-over inter-module methods (`claimSession`, `carryOverSessions`) with the session descriptor (`id`, `key`, `mode`, `segment`), so workflows can resume or fork a session and rerun attempts can carry sessions forward.

  Session claims are released automatically on step-attempt and job termination, with a stale-claim reap cron as a backstop.

  The previously required `jobLeaseTokenTtlSeconds` option on `createAgentModule` is removed; pass an optional `workflows` client to enable the job-terminated grace sweep.

### Patch Changes

- 870523f: Adds the tool step model: a `kind: 'tool'` step in the `definitions-dto` step union (snapshot version 3) carrying `tool`, `connection`, `with`, `outputMappings`, and `templates`, with sync-time validation (`missing-connection-for-tool`, `integration-connection-not-found` / `-not-capable`, `unknown-integration-tool`, `tool-input-invalid`, `tool-input-unknown-key`). `@shipfox/api-workflows` and `@shipfox/api-workflows-dto` add the tool step to the run-graph step type union and its display name. The workflow document parser still rejects tool-step fields, so nothing is user-authorable yet.
- Updated dependencies [d1fb0a3]
- Updated dependencies [c1e5dfd]
- Updated dependencies [870523f]
  - @shipfox/api-agent-dto@16.1.0
  - @shipfox/api-definitions-dto@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [03e03c7]
- Updated dependencies [117edfd]
  - @shipfox/api-agent-dto@16.0.0
  - @shipfox/api-definitions-dto@16.0.0

## 15.0.0

### Minor Changes

- af095a4: Adds the `startDevRun` inter-module method that creates a workflow run from an inline model and snapshot with `origin: 'dev'` and dev provenance, numbered by the workflow lineage id. Manual `subscriptionId` and cron `scheduleId` trigger payload fields become optional so a dev trigger can fire without a subscription row.

### Patch Changes

- Updated dependencies [a7804a8]
- Updated dependencies [07410fe]
- Updated dependencies [989eb11]
  - @shipfox/api-definitions-dto@15.0.0
  - @shipfox/api-agent-dto@15.0.0

## 14.0.0

### Minor Changes

- 4f30864: Trigger `event` is now optional end to end. An omitted event subscribes to every event from its source. Explicit events continue to work unchanged. Built-in manual and scheduled triggers use `fire` and `tick`, respectively.
- b766ee3: Adds `origin` and `dev_source` to workflow runs, with an `origin` facet on the run list and aggregates endpoints. Existing runs read as `synced`. Dev runs check out their pinned source commit by default, while same-project replay event commits retain precedence.

### Patch Changes

- Updated dependencies [09924ca]
  - @shipfox/api-agent-dto@14.0.0

## 13.1.0

### Minor Changes

- 0d3c2e3: Updates @shipfox/client-agent, @shipfox/client-onboarding, and @shipfox/client-workflows to show
  managed inference providers without exposing workspace credential setup, keep workflow examples
  limited to supported models, and explain managed-provider failures in workflow runs.

### Patch Changes

- Updated dependencies [0d3c2e3]
- Updated dependencies [5c100d6]
- Updated dependencies [ca91dc3]
- Updated dependencies [67aab38]
  - @shipfox/api-agent-dto@13.1.0

## 13.0.0

### Major Changes

- af6b31e: Expose ordered queued and terminal workflow job-execution facts, and release terminal runner reservations once no uncancelled lease remains.

## 12.7.0

### Minor Changes

- 4df5e37: Workflow run list items and run detail now carry `has_started_job_execution`, reporting whether any
  job execution of the attempt reached a runner. Run surfaces no longer show a client-derived `Queued`
  state: the run list and run detail present the API attempt status and duration, and read the new
  field to label a finished run's duration as run or elapsed time.

## 12.6.0

### Minor Changes

- 53b87f0: Distinguish queued and executing jobs in workflow run list status strips.

## 12.5.0

### Minor Changes

- 5b1838c: Expose actionable status reasons and messages when materialized job outputs cannot be persisted.

## 12.3.0

### Minor Changes

- 4b0731e: Adds workflow troubleshooting details, evaluation traces, failure annotations, runner context, step output metadata, and lazy paginated annotation summaries.

## 12.2.0

### Minor Changes

- ce0984d: Preserve structured values when jobs map typed step outputs, normalize them for JSON persistence, and bound materialized job output sizes and entry counts.

### Patch Changes

- @shipfox/api-agent-dto@12.2.0

## 12.1.0

### Minor Changes

- 312a137: Add typed step errors for invalid checkout paths and occupied checkout destinations.

## 12.0.0

### Major Changes

- adf07e7: Cut over workflow and job display names to literal-only `name` fields, with runtime interpolation supported through `run_name` and `execution_name`.
- 54c820e: Add the trigger reference and the current attempt's jobs to each workflow run in the run list response.

  `trigger_reference` carries the repository, ref, commit, and actor a source-control trigger resolved, or null for triggers that resolve none. Jobs arrive as `jobs`, a preview bounded by the new `WORKFLOW_RUN_JOB_PREVIEW_LIMIT`, alongside `job_status_counts` covering every job of the attempt including those past the preview.

- 032d316: Scope checkout credential minting to the currently running checkout step and return its fetch depth.

### Minor Changes

- ee2ce67: Accept a `${{ }}` interpolation in an agent step's `thinking` field. The schema
  still offers the per-harness enum for editor completion, and the dispatcher
  checks the resolved value against the harness levels. An unsupported
  resolved level fails the step.
- f7939c7: Add resolved checkout details as a dedicated step-report field.
- dea1ffd: Expose normalized repository references on listening execution events.
- 285fff2: Persist resolved workflow job execution names and handle dynamic naming failures consistently.
- e44a279: Persist nullable resolved workflow run-name overrides alongside static workflow-name snapshots.
- 35a42bd: Resolve run and agent step working directories against the runner job workspace.
- d77baaa: Add per-definition sequential numbers to workflow runs and expose them in the API and expression context.
- c2a8e54: Normalize checkout target fields for step-dispatch resolution, reject unsupported job-level checkout fields, and keep the workflow model and runtime checkout contracts aligned.
- cb0abfa: Expose the normalized trigger project, repository, ref, and commit in workflow context.

### Patch Changes

- Updated dependencies [ee2ce67]
- Updated dependencies [f78740d]
- Updated dependencies [28daafe]
  - @shipfox/api-agent-dto@12.0.0
  - @shipfox/inter-module@0.2.3

## 10.0.0

### Minor Changes

- 22bf8a2: Classifies runner agent harness startup failures separately from user-fixable agent configuration errors.

### Patch Changes

- Updated dependencies [43ce975]
  - @shipfox/api-agent-dto@10.0.0
  - @shipfox/inter-module@0.2.2

## 9.3.0

### Minor Changes

- 6017e56: Reject new workflow work for suspended or deleted workspaces with stable non-retryable results.

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-agent-dto@9.0.2
  - @shipfox/inter-module@0.2.2

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/api-agent-dto@9.0.1
  - @shipfox/inter-module@0.2.1

## 9.0.0

### Patch Changes

- Updated dependencies [46aa52f]
  - @shipfox/api-agent-dto@9.0.0
  - @shipfox/inter-module@0.2.0

## 8.0.0

### Patch Changes

- Updated dependencies [de559bb]
  - @shipfox/api-agent-dto@8.0.0

## 6.0.0

### Minor Changes

- 23563de: Moves Triggers to the injected Workflows inter-module contract with stable run idempotency and listener delivery commands.
- 23a4dc2: Moves Logs and Integrations to injected Workflows inter-module clients with minimal log and leased agent-tool queries.

### Patch Changes

- Updated dependencies [0bb82a4]
- Updated dependencies [81f9544]
  - @shipfox/api-agent-dto@6.0.0
  - @shipfox/inter-module@0.2.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

## 0.1.0

### Minor Changes

- 5c18360: Durable gate restart: a failing gate's `on_failure.restart_from` now records the failed attempt, rewinds the job's step projection from the named earlier step back to pending (opening fresh attempts), and leaves the job running so it re-executes from there — all in one transaction with the report. A per-step attempt cap (default 3) bounds restart loops, exhausting to a `restart_exhausted` failure. Adds the `workflows.step.restart_enqueued` event.
- 7a9943d: Adds the backend contract for per-step execution: job claims mint a lease token for the step API, step reports carry attempts and exit codes, and workflow completion can be signalled through the workflows outbox. The runner-side step loop is intentionally owned by the follow-up runner protocol work.
- 736249b: Expose step attempts in the read API: the run-detail endpoint now returns `current_attempt` on each step plus its per-attempt history (`attempts[]`, with status, exit code, gate result and restart reason), so a restarted step's attempts are visible.
- 2bc5595: Adds workflow-run cancellation across the API, orchestration queue cleanup, event contract, and run-page cancel action.
- 940696a: Adds the credential-free checkout intent type and a checkout-token response DTO (basic/bearer auth with a validated expiry) to the Orchestration DTO package, establishing the contract for runner-managed repository checkouts over the lease-scoped checkout flow.
- e9396c9: Give every runner-dispatched job a synthetic "Set up job" step at position 0 (à la GitHub Actions), so failures that happen around the user steps — workspace preparation today, the repository checkout next — are reported through the existing per-step protocol instead of hanging the job until the lease/timeout fires. The runner prepares the per-job workspace inside this step and reports the outcome; a failed setup flows through the existing fail-job cascade, finalizing the job `failed` in seconds with no user step run.

  Extends `stepErrorDtoSchema` with an optional machine-readable `reason` (`workspace_prep_failed`, `git_unavailable`, `checkout_*`, `setup_aborted`) and a `category` (`setup` | `user`). The runner reports `reason`; the server derives `category` from the step type on read (the runner is an untrusted boundary). The restart resolver now skips the synthetic step so a user step named "Set up job" can never rewind setup mid-job.

- 3afb7e3: Adds job execution success expressions and execution timeouts to workflow documents.
  Renames job execution IDs in auth, runner, workflow, and timeout event contracts to the explicit `jobExecutionId` / `job_execution_id` shape.
- c652a68: Add a single reliable job-terminal event: `workflows.job.terminated` is now written in the same transaction as every terminal job-status flip (normal completion, DAG cancellation, lease-expiry resolution, and timeout), and the run-level `workflows.workflow_run.terminated` is emitted the same way. All workflows event names are aligned on one `WORKFLOWS_<entity>_<verb>` scheme, so the run and job terminal events read as the same event at two scopes.

  Internal breaking change (`WORKFLOWS_JOB_COMPLETED` → `WORKFLOWS_JOB_STEPS_SETTLED`, `WORKFLOW_RUN_*` → `WORKFLOWS_WORKFLOW_RUN_*`, with matching DTO type renames) consumed only within this monorepo.

- c0a883c: Adds the runner-facing per-step endpoints (`POST /runs/jobs/current/steps/next` and `/steps/:stepId/report`) authed by a locally-verified job lease token, with the matching request/response schemas.
- d69b164: Adds workflow run attempt lineage APIs and a run summary switcher for navigating rerun attempts.
- e699508: Adds first-class skipped workflow jobs with persisted status reasons across API DTOs, orchestration, events, and client run views.

### Patch Changes

- eb40964: Add an inline `agent` workflow step that the runner runs with the pi harness. A step is an agent step when it carries `model` + `prompt` and no `run`; it takes a free-text `model`, a single `prompt`, and an optional `thinking` level (default `high`). The step runs to process-success (the agent ran to completion) and reports through the existing step protocol with no runner/backend protocol change, so change quality is judged by a downstream `run` + `gate` step. v1 does not persist the agent's work (no diff, commit, or PR).
- c17dd6e: Adds run-step output emission through `$SHIPFOX_OUTPUT` with runner-side parsing, caps, masking, and report plumbing.
- f98c2be: [api/workflows] Add the lease-authed `POST /runs/jobs/current/checkout-token` endpoint. The runner exchanges its job lease for short-lived, read-only repository checkout credentials. The job's checkout intent is resolved server-side from the authoritative `jobId` claim (`job -> run -> project` source metadata) and minted on demand via the integration service's `createCheckoutSpec()`; no credential material is ever stored on the job/run or queued. `checkoutTokenResponseSchema.auth` stays optional so credential-free providers can return a public clone URL with no token, and `integrationRouteErrorHandler` is exported from `@shipfox/api-integration-core` so the route reuses the shared provider-error mapping.
- b525dcd: Let an agent workflow step pick its pi provider with an optional free-text `provider` field (default `anthropic`), threaded to the runner's pi model lookup, and split agent-step failures into a user-fixable `agent_config_invalid` reason (unknown provider, missing runner credentials, wrong provider/model pair) versus `agent_invocation_failed` for genuine provider/API errors.
- 795f440: Adds the listener orchestration loop for long-lived listening jobs: durable event draining, one execution per buffered event, resolution on until, listening deadline, or max executions, and a run-timeout backstop that resolves active listeners.
- 3dcd751: Adds listener filter snapshots to job activation events and persists them on listener subscriptions.
- 362b3eb: Scope runner log append authorization to the dispatched step attempt carried by the job lease token.
- 2fb3e87: Derives workflow run attempt durations on the client and displays them in the run list and run header.
- ef1e917: Adds listening-job authoring fields and trusted execution context validation for listening jobs.
  Separates workflow identifiers so internal rows use UUID `id`, authored workflow/job/step
  references use `key`, and UI labels use `name`.
- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
- 8ecc121: Track queue/run/finish timing for workflow runs and jobs. Adds nullable `started_at`/`finished_at` to workflow runs and `queued_at`/`started_at`/`finished_at` to jobs, exposed on the run and job DTOs. The runners module emits two new authoritative-timestamp events (`runners.job.queued`, `runners.job.started`) in the same transaction as the enqueue/claim; workflows projects them onto the job row with a first-write-wins `coalesce`, so the at-least-once outbox can redeliver out of order safely. Run `started_at`/`finished_at` and job `finished_at` are stamped in-module at the status transitions. All columns are nullable and eventually consistent, so consumers must treat a missing endpoint as "not yet known" and clamp any duration math.
