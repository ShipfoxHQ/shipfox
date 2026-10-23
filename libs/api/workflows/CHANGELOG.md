# @shipfox/api-workflows

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

- 2526ccf: Adds the Cache module and the routes a runner calls to save and restore a job cache. A save reserves a key, uploads the archive straight to object storage through signed part URLs, and commits. A restore finds the entry by exact key or restore key and signs a download URL. A dev run saves into a sandbox of the user who started it. The object store gains signed multipart uploads and a `publicEndpoint` option for signed URLs. The Workflows contract gains `getWorkflowRunOrigin`. Set `CACHE_STORAGE_S3_*` to give the cache its own bucket.
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

- b9a53b2: Adds `status_reason`, `status_reason_message`, and `outputs` to the run overview attempt. The `shipfox` provider's `get_workflow_run` tool returns them on its attempt, and the agent-access `get_workflow_run` tool returns them on the run.
- dcd0b79: Workflows reads `gate.on_failure` as one rule or a list of rules with an optional `if`, restarts from the first rule that applies, and records the decision on the step attempt's gate result.
- 67e55ea: Models concurrent steps: the document fields, normalization, sync rules, and storage.

  **Breaking:** `WorkflowDocumentJob['steps']` now holds steps and `parallel` blocks, so code that reads `job.steps` as a list of steps must use `jobSteps(job)`. `WorkflowModelStep` gains the `wait` and `cancel` kinds, so a `switch` over `kind` must handle them.

  - **Document:** steps gain `background`, `wait`, `wait_all`, and `cancel`, and a job's `steps` can hold a `parallel` block of at least two steps. `jobSteps(job)` yields every step with its document path, `parallel` members included, and every walker over a job document now uses it, so a `uses:` or `prompt` file inside a block is still found. `job.steps` now also holds blocks. `workflowDocumentSchema`, `parseWorkflowDocument`, and `buildWorkflowJsonSchema` accept the five keys. `rawJobSteps(input)` walks the steps of a document that is not parsed yet.
  - **Workflow model:** steps gain `background`, `parallelGroup`, and `joinedAt`, plus `wait` and `cancel` step kinds. Normalization expands each `parallel` block into background steps followed by a wait, resolves `wait_all` to explicit targets, adds a closing wait when background steps are still running, and checks the order rules: a background step needs a `key`, takes no gate, and cannot overlap a `checkout`, a gate cannot restart past a running background step, and concurrent steps cannot share an agent session. A step reads a background step only after the wait that joins it. A model with a concurrent step is stored as snapshot version 8.
  - **Storage:** steps gain `background`, `parallel_group`, and `joined_at`, step attempts gain `cancel_requested_at`, and `wait` and `cancel` are step types. Dispatch context and `env_sources` skip a background step until a wait has joined it.
  - **API:** the step type of a job detail and of the agent access read tools can be `wait` or `cancel`.

- 6b01f3d: Names the missing variable and where it is read when a run cannot start. `InterpolationUnresolvableError` and the `interpolation-unresolvable` inter-module error carry optional `variableKey`, `jobKey` and `step`. Predicates report `job.if`, `job.success`, `job.listening.filter`, `step.if` and `step.gate.success` instead of `env`. The error message no longer suggests `has()` for a missing variable.
- a15e118: Lets a managed model provider refuse a model for one workspace at run time. A provider opts in by implementing `availability`, which returns the workspace's locked models. A locked model fails the step with a 422 `agent-model-unavailable` response and a policy notice. An error from `availability` returns a retryable 503. Credential renewal doesn't recheck, so a running step is never cut off. The stored step error carries the notice, and the model unavailable callout shows its message and required action. Providers without `availability` behave as before.
- 4aad893: Adds machine placement rules for installation provisioning. A policy can now pass `placement.resolve`, and a job that needs a reserved runner label but only matches refused templates fails within one poll with the new `runner_not_allowed` status reason and its notice. The client shows the notice and its action.
- d657853: Adds `run_after` to steps and jobs. Set it to `success`, `failure`, or `always` to choose when a step or job runs after an earlier failure. It defaults to `success`, and an `if` now adds to it instead of replacing it. Workflows stored before this change keep their current behavior until their file is next synced.
- 4b8d8a5: Lets a tool step that reads restart its job through `gate.on_failure`, so a workflow can read again until a provider applies a change. A tool step that writes still fails its job without a restart.
- 507915a: A required action can carry an optional `intent`, and `REQUIRED_ACTION_INTENTS` lists the known values. `intent` names a behavior a composing application may provide in place of opening `url`, such as `contact-support`. `url` stays required as the fallback, and an unknown `intent` still parses.

  The admission denial contract, the HTTP 409 `required_action`, and the agent-access error details now keep `intent` when it is set.

- 2c36559: The `workflows.workflow_run_attempt.created` and `workflows.workflow_run.terminated` events carry the run `origin`, `dev` or `synced`, so consumers can tell dev runs from synced runs without reading the workflows tables. A rerun reports the origin of its source run. The field is optional because events written before this change don't have it.
- 395e11d: Schedules concurrent steps on the server and the runner.

  - **Protocol:** the `next` request takes an `in_flight` list of the step attempts the runner holds. Each `next` response carries `cancel_step_ids`, and a `step` response says whether it is `background`. A `report` accepts `cancelled` for an attempt that a `cancel` step is stopping, which confirms that its process exited. The step DTO and the job detail steps gain `background` and `parallel_group`.
  - **Scheduling:** a running background step lets later steps start, and any other running step blocks them. A `wait` step blocks until every step it names has ended, and it fails when one of them failed without `continue_on_error`. A `cancel` step stops running targets without waiting for them. A checkout, an action post, and a step whose earlier attempt is stopping wait until the stopped process is confirmed, and the job does not finish before that. A background step no longer counts for the job result.
  - **Limit:** `WORKFLOWS_MAX_CONCURRENT_STEPS` caps the steps of one job that run at the same time. The default is 20.
  - **Metrics:** adds the `workflows_step_cancelled` counter, labeled by `reason`.

- a429987: Adds the shared policy notice contract and preserves the workflow admission type export.
- 94e77bc: Stores an optional runner-reported `log_path` on step attempts and exposes it in dispatch context when a finalized step log is available.
- 2100749: Adds `continue_on_error` to steps. When such a step's own work fails, the step still ends `failed`, but its failure does not count for `run_after`, `execution.failed`, or the job result. Gate restarts run first, and the flag applies to the final failure. It does not cover a step that cannot start, such as an `if` that cannot be evaluated, or a job that times out.

  - **Workflow model:** a step carries `continueOnError: true` when set. A model with such a step is stored as snapshot version 7. Sync rejects the field on a step that uses a composite action.
  - **Storage:** the steps table gains `continue_on_error`, and step attempts gain `failure_ignored`.
  - **API:** the step status reason gains `failure_ignored`. Every step in a job detail carries `affects_job`, and an attempt that `continue_on_error` covered carries `failure_ignored: true`. The agent access read tools accept the new status reason.
  - **Run page and annotations:** an ignored failure shows as a warning, like a post with `post_failure: warn`, and its failure card is a warning. The job page opens on the first failure that counts.

- dd20040: Names the cause of a refused start when an agent step's configuration cannot be used. The agent `agent-config-invalid` error carries a `reason` (`model-unknown`, `provider-unsupported`, `harness-unsupported`, `thinking-unsupported` or `workspace-providers-disabled`) with the `model` and `provider` where they apply. `agent-config-unresolvable` passes them on with the job and step, in the inter-module error, the 422 `details` (`reason`, `model`, `provider`, `job_key`, `step`) and the trigger diagnostic. Every new field is optional, so stored diagnostics still map.
- daf0208: Names the cause of a refused start when an integration connection or tool cannot be materialized. `agent-integration-materialization-failed` carries a `reason` (`connection-missing`, `connection-provider-mismatch`, `source-connection-missing`, `tool-unknown` or `no-tools-selected`) with the `connection` and `tool` where they apply, and the job and step it came from. They reach the inter-module error, the 422 `details` (`reason`, `connection`, `tool`, `job_key`, `step`) and the trigger diagnostic. Setup failures keep no reason. Every new field is optional, so stored diagnostics still map.
- 3c8db4c: The gate of a tool step can read `step.error`, with the `code` and optional provider `status` of a failed tool call, or null when the call did not fail. A gate can accept an expected failure and tell a missing object from an outage.
- 6b2a308: Adds the workflow outputs runtime. `WorkflowModel` gains optional `outputs` and `outputTypes`. When a run attempt succeeds, its outputs are evaluated with the job-output limits and stored on the attempt. An output that cannot be evaluated or is too large fails the attempt with the `output_invalid` or `output_too_large` status reason. The lifecycle event context returns `run.outputs`, and run creation errors can name the `workflow.outputs` field.
- 0b661c9: Step dispatch fills the `runner` context and turns `hashFiles()` calls into runner bindings.

  - **`@shipfox/api-workflows-dto`:** adds `stepBindingSchema`, whose segments are `literal`, `secret`, or `hash_files` with its `patterns`. Step configs keep bindings under `secret_bindings`.
  - **`@shipfox/api-secrets-dto`:** exports `secretBindingLiteralSegmentSchema`, `secretBindingSecretSegmentSchema`, `secretBindingAnyTargetSchema`, and `SecretBindingTargetDto` so the step binding schema reuses them.
  - **`@shipfox/api-workflows`:** `nextStepForLeasedJobExecution` accepts a `runnerPlatform` loader, called once per request and only for a step that reads `runner`. An action input filled on the runner must be a string input, whether it reads a secret or calls `hashFiles()`.

### Patch Changes

- e99aa97: Action steps pass secrets to their inputs by reference.

  - **Binding target:** a secret binding's `target` is either an environment variable name, as before, or `{kind: 'input', name}` for an action input. Run-step bindings keep their shape.
  - **Dispatch:** a `with` input whose whole value is a secret reference becomes an input binding. The step config and the evaluation trace hold only the reference, never the value. The input must be declared as a string, or the attempt fails with `action_input_invalid`.
  - **Step secrets:** `GET /runs/jobs/current/steps/:stepId/secrets` serves action steps as well as run steps.

- 066e73c: Action steps expose their workflow job key as `context.jobKey`.
- 2d52a6c: Action step configs mark each granted tool and method as sensitive or not, so the runner keeps sensitive tool arguments and results out of the step log.
- 1f218c4: Treats every runner as able to renew Git and managed inference credentials. The runner capability manifest no longer has `features`, and `runnerFeaturesSchema` and `RunnerFeaturesDto` are removed. Registration still accepts a `features` key from older runner images and ignores it. `ManagedModelProvider.resolveCredentials` no longer receives `renewableInference`, and `RUNNER_CAPABILITY_REQUIRED_ERROR_CODE` with its `runner-capability-required` error is removed. A composing application must stop using both and always issue renewable credentials. The API no longer writes the "Renewable Git credentials are unavailable on this runner" annotation.
- c4f486b: Names the cause of a checkout failure. Each refusal now identifies the repository, connection or project it was about, a suspended or removed GitHub App installation has its own `installation-inactive` code, and GitHub's own explanation reaches the step error as `provider_message` and `provider_status`. A missing repository now returns a 422, and a failed token mint is cached for 60 seconds instead of 15 minutes.
- c25c566: Shows the cause of a checkout failure and its fix. The failure annotation and the run page choose their copy from the error code of the refused checkout, and show the provider's own explanation when there is one. A refused checkout-token request now returns its cause in `details.message`, and a provider refusal names the repository and the connection.
- 7fddfc5: A checkout-token refusal for an explicit `checkout.project` names the repository when the project has a source owner and name. `resolveCheckoutTarget` returns both as `sourceRepositoryOwner` and `sourceRepositoryName`.
- 5d5d006: A checkout with `persist-credentials: false` can now get a fresh credential when the runner reports that the first one was rejected.

  - **Replacement scope:** this now works for every initial checkout with credentials, including non-persisted ones.
  - **After success:** a non-persisted checkout still gets no replacement once its step attempt finishes.
  - **Response:** a replacement credential keeps the step's `persist` setting instead of always reporting `true`.

- 476e3b1: An `action.yml` can set `steps` instead of `main` to declare a composite action. Sync expands it into the definition model.

  - **Breaking:** `ActionManifest` is now a union of a JavaScript and a composite manifest, so `main` can be `undefined`. Narrow it with `isCompositeActionManifest`. `actionManifestSchema` is a transform, so it no longer exposes `.shape` or `.extend`.
  - **Manifest:** a composite manifest sets `steps` instead of `main`, and has no `runtime`, `post`, or `post_failure`. Its outputs need `value`, and its inputs can set `secret: true`. Inner steps reject `checkout` and `export`, and a tool step needs `connection`. `uses:` and prompt `file:` accept a leading `${{ action.path }}/`. `safeParseActionManifest` rejects composite manifests unless `compositeActions` is set.
  - **Expressions:** `action` is a reserved root, readable only inside a composite action. `buildCompositeScopeEnvironment` types its inner `inputs` and `action`, and `action.outputs` is the field for an output `value`.
  - **Resolution:** composite actions are resolved recursively, at most 5 levels deep. A cycle fails with the new `action-cycle` sync error code, and deeper nesting with `action-nesting-too-deep`. The 20-action limit counts the whole tree, and the content hash covers every action and prompt file in it.
  - **Workflow model:** a `composite` step holds its inner steps, with path ids, scoped `inputs` and `steps`, secret inputs rewritten to the caller's references, and aliases bound to the caller's connections. A nested grant must fit inside its outer alias. Source locations can name the composite file. Snapshots with a composite step use version 6, and `flattenJobSteps` lists a job's steps in run order.

- fb79732: Definition sync and dev runs resolve registry actions, such as `uses: shipfox/slack-thread-digest@1.4.2`. Registry actions turn on when `DEFINITION_ACTIONS_ENABLED` is on and `REGISTRY_URL` is set. Definitions now read `REGISTRY_URL` too, to decide whether to accept registry references.

  - **Resolution:** the Registry module returns a verified version, and the definitions module checks that the bundle's `action.yml` equals the signed manifest. Sync and dev runs store the bundle as a workspace action snapshot with the new `registry` source, so the runtime bundle route and the runner stay unchanged.
  - **Limits:** the 20-action limit per workflow file counts repository and registry actions together. Registry bundles skip the repository size limits and the relative import check, because the registry bundles them. Uploads apply to `./` paths only.
  - **Model:** action steps gain `origin` (`local` or `registry`), and registry steps also carry `package` and `version`. Models stored before this change omit `origin` and mean `local`. The step config sent to the runner carries the same fields.
  - **Sync errors:** a missing version is `action-not-found`. A version that fails verification, an unsupported document format, or a bundle that differs from its signed manifest is `action-invalid`. Both appear as diagnostics on the workflow file that references the action. An unavailable registry fails the sync attempt and retries.
  - **Dev runs:** a registry failure fails the run with an `invalid-definition` message that names the action.

- 2e5a311: Dev runs accept action uploads. `POST /dev-runs` and the `create_dev_run` MCP tool take an `actions` field: whole action directories, each replacing the ref's copy of its `uses` path. Both routes accept bodies up to 4 MiB. The `create_dev_run` description tells agents which files to send. The run DTO's `dev_source` gains `local_actions`, the uploaded action paths. It defaults to an empty list for older runs.
- a02f5cf: Adds Discord to the client integrations gallery with OAuth install and callback wiring. Adds the callback DTO contract and Discord provider name to workflow failure annotations.
- dc8065c: Fails a step or job when its `if` can't be evaluated, instead of skipping it. The step error reason is `condition_errored`, and the failure names the cause.
- 39c5466: A failed step keeps the outputs it set, typed by their declarations. Values that do not match their declaration are dropped.
- 0c9d83e: Run creation freezes the tool grants of action steps. Each integration alias resolves to its connection and to the concrete tools its selectors match, with methods, sensitivity, and result kind. The grants are stored with the run attempt, so reruns reuse them and a tool added to the catalog later does not widen them. An action step's config lists the granted tools of each alias. An unavailable or mismatched connection fails run creation.
- 205afb5: A failed step attempt shows which `gate.on_failure` rule restarted the job, that no rule applied, or which rule could not be evaluated. The run page and the Agent Access step attempt tools return the same decision, and a step with a rule list shows the attempt limit of the rule its latest restart used. Agent Access no longer blanks the first root of an evaluation trace entry.
- a73e712: The integration tool gateway serves action steps as well as agent steps.

  - **Leased tool context:** `getLeasedAgentToolContext` keeps its name and accepts leased `action` steps. Other step types still fail with `leased-step-not-agent`. The result gains `stepType` (`agent` or `action`). For an action step, `integrations` holds the tools frozen at run creation, with one entry per connection, and each tool carries its `result` kind.
  - **Audit:** the tool call caller adds `action`, on both the audit line and the `integrations_agent_tool_call` metric label. When the runner sends `x-shipfox-call-id`, the audit line records it as `callId`.

- 9e173c3: Adds `provider_access` to a connection that lost access at the provider, either `removed` or `suspended`. Enabling such a connection now returns 409 `connection-provider-access-unavailable`, and a checkout on it tells the runner to unsuspend or reinstall the GitHub App. GitHub reports the access from the installation and no longer returns an external URL after an uninstall.
- ef7cf4a: Adds the `container_setup_failed` step error reason. The runner reports it when the setup step cannot pull or start the job container.
- e087b95: A job keeps its project checkout at the root when its first step checks out a repository into its own `path`.
- 8872f36: Shipfox lifecycle events now resolve their workflow context by lineage, so `source: shipfox` triggers dispatch instead of being dropped. The definitions contract adds a `getWorkflow` method for this lookup.
- fc455ac: Workflow runs materialize and dispatch action steps (`uses`). Definitions accept `uses` only while `DEFINITION_ACTIONS_ENABLED` is on, and it stays off in production for now.

  - **Step type:** steps gain the `action` type. The job detail and agent access step type enums accept it.
  - **Config:** an action step's config carries the action (`uses`, snapshot digest, `main`, and name), its `inputs`, the merged workflow, job, and step `env`, the connection binding of each integration alias, and the manifest outputs with `required`.
  - **Dispatch:** `with` values are completed at dispatch. Defaults fill omitted inputs, and each value is coerced to its declared type. A value that fails coercion fails the attempt with the new `action_input_invalid` reason.
  - **Error reasons:** `stepErrorReasonSchema` adds `action_input_invalid` (user) and `action_unavailable` (setup, for a runner that cannot load the action snapshot). The agent access diagnostics enum adds both.
  - **Interpolation fields:** the workflows and triggers inter-module error schemas accept `action.with`.
  - **Reruns** copy the attempt model, so they run the same action snapshot.
  - **Client:** the step error reason type accepts the two new reasons.

- 18a5420: A step field segment that mixes `steps` with an earlier context, such as `event`, `run`, `workflow`, `trigger`, `inputs`, `job`, `needs`, or `executions`, now resolves at step dispatch instead of failing with `config_unresolvable`. When a field reads a context that its fill site does not provide, the error no longer suggests `has(x)`.
- ecc70c2: A step or job `if` condition that cannot be evaluated now records the error in its evaluation trace, with the missing path and the status of the step or job it reads. The run UI says which value is missing and why. A step that has not run exposes empty `outputs`, so `has(steps.x.outputs.y)` returns `false` instead of failing.
- af3b91f: Definition validation normalizes action steps (`uses`) into the workflow model.

  - **Model:** `WorkflowModelActionStep` carries the action's path, snapshot digest, name, entry file, input declarations, and integration bindings, plus `with`, `env`, and outputs from the manifest. Every output declares `required` explicitly, and the manifest default is `false`.
  - **Validation:** `DefinitionValidationOptions.actionManifests` supplies the manifest and digest for each `uses` path. A step is checked against its manifest: known inputs, required inputs, literal input types, secrets only as whole top-level input values, one connection per integration alias, and connections that exist, match the alias provider, and serve agent tools. Manifest selectors must exist in the provider catalog, and write tools need `allow_write`. An action without a resolved manifest fails with "could not be resolved".
  - **Integration context:** `needsIntegrationValidationContext` also returns `true` when a referenced manifest declares integrations.
  - **Workflows:** run creation rejects action steps until they can be materialized.

- e40ec8b: Adds an optional `required` flag to step output declarations. When a declaration sets `required: false`, `coerceStepOutputs` accepts a result without that output and still type-checks the value when it is present. Declarations without the flag stay required. Expressions can check an optional output with `has()`. Reading an absent output raises the existing missing-path error.

  The workflows step reader now keeps `required` when it reads output declarations from step config.

- 3869c1d: Fail queued job executions that are not claimed before the configured queue timeout and start execution timeouts from the persisted claim timestamp.
- 6c0d6bd: Adds Shipfox run and job lifecycle events for workflow triggers.
- eca4c27: Stops runs that check out the project's source while its connection is missing, disabled, or in error. Trigger starts and listening-job deliveries now fail with the `source-connection-unavailable` known error. Cron records an errored tick and sends no failure alerts, and the next tick after recovery starts a run. A manual fire returns 422.
- c6f2ae3: `checkRunReadiness` now reports `agent-config-invalid` for an agent step whose model, provider or thinking level the agent module refuses. It checks only steps whose `model`, `provider` and `thinking` are literal or absent, so a templated value never produces an issue. An absent value falls back to the workspace defaults. The issue blocks the start for a normal job, and fails the job when the job is listening or the session key is filled after run creation. The readiness route returns the new issue with its `reason`, `model` and `provider`. `@shipfox/expression` exports `shouldFillAtSite`.
- fafbe84: `checkRunReadiness` now reports `secret-missing` for a step secret that is defined at neither workspace nor project scope. It fails the job after the run starts, and never refuses the start. Each definition also lists the `secrets.inputs.*` it reads, so a trigger can compare them with its secret mappings.
- 737c625: Adds the `checkRunReadiness` inter-module operation, which reports the variables a workflow reads that are not defined at workspace or project scope. Each `variable-missing` issue says whether it blocks the run from starting or fails a job after the run starts, and where the variable is read.
- ac90873: Listener executions no longer write the legacy trigger-event array, and the `WORKFLOWS_LEGACY_TRIGGER_EVENTS_WRITE_ENABLED` setting is removed.
- a9f19e0: Re-run failed jobs now also re-runs every succeeded job that depends on a re-run job, instead of reusing it.
- 9110230: When a gate restarts an agent step, the agent's prompt now ends with one block that names the failed check, its exit code, the gate feedback and the path of the failed check's log. Without an authored `feedback`, the restart feedback now says "The check `<condition>` returned false." instead of "gate condition not met".
- 97f6dab: Explains a `run_after` skip in the run UI: the copy says what did not succeed and which `run_after` value runs the step or job after a failure. A job skipped by `run_after: failure` now records the check that rejected it. The skipped-step copy is worded for a step instead of a job. The `write-a-workflow` and `debug-a-failed-run` skills now describe `run_after`.
- b8b990d: Run and action steps can access `SHIPFOX_RUN_ID`, `SHIPFOX_RUN_NUMBER`, `SHIPFOX_RUN_ATTEMPT` and `SHIPFOX_RUN_URL` as environment variables.
- 04680a3: Extract the run requirement collector so variable and secret references carry their job and step location.
- 9906470: Adds `from_file` and `from_stdout` to run step output declarations. A run step can read an output from a file in the job workspace or from its standard output, up to 64 KiB, instead of writing to `$SHIPFOX_OUTPUT`. The run dispatch config carries them as `output_sources`.
- 5276fca: Adds `GET /runs/jobs/current/steps/:stepId/action-bundle`, which returns the gzipped action bundle for the runner's currently leased action step. The step must be the lease's current step and an `action` step. The digest comes from the step config, and a missing snapshot returns 404 `action-snapshot-not-found`. Responses are sent with `cache-control: no-store`.
- 8aa2d59: Names the missing value and the step or job that should have set it when a step `if` can't be evaluated. The step error and the failure annotation both carry that text.
- 9bac67e: Run, action and agent steps dispatched to a runner carry `env_sources`: the earlier steps, in position order, whose current attempt the runner executed.
- f6bc1f4: Adds `export` to run, agent, action, and tool steps. `export: true` promotes every declared output of the step to a job output of the same name, and `export: [names]` promotes the listed ones. A later job reads them with the usual types. Sync rejects an unknown name, a clash with the job `outputs` map, and two steps that export the same name. A job output exported from a step that did not produce it is omitted instead of failing the job.
- d0c49b5: Step and job failure copy uses plain words and active voice, and each message names the next action.

  - **Rerun or new run:** a message says "rerun the job" when a workspace setting fixes the failure, and "start a new run" when the workflow file must change. A rerun keeps the workflow file of the original run.
  - **`@shipfox/client-workflows`:** the step failure callouts and the job empty states use the new copy. The model availability callout names the model, for example "claude-opus-4-8 is not available in this workspace". `lease_expired`, `provider_lost`, `lifecycle_violation`, and `runner_lost` share one title; the failure code still tells them apart.
  - **`@shipfox/api-workflows`:** failure annotations give the same recovery advice as the step callouts. Annotations that already exist keep their old text until the step or job fails again.

- 651153a: Run and agent step output declarations accept a `default`. When a step has no value for an output, for example because it was skipped or its run step succeeded without writing it, later steps and job outputs read the default from `steps.<key>.outputs`. A default that does not match its declared type or `schema` fails sync. `steps.<key>.outputs` now reads the step's current attempt, so a step that a gate restart skips on the rerun no longer shows the previous pass's values, and it is `{}` before the step's first attempt finishes.
- 901e5b3: A step that fails on a missing secret now names the secret.

  - **API:** `secret-not-found` and `secret-input-missing` from the step secrets route carry `details: {key, store}`.
  - **Runner:** the step failure reads "Secret `K` is not set in this project or workspace." or "Secret input `K` was not passed to this run." When the API sends no details, the runner keeps the generic message.

- 0b2af13: Tool step outputs keep JSON-looking strings as strings instead of parsing them into numbers or booleans.
- 68e8e1d: Failed tool calls mark their trace span as an error, and the API traces outbound `fetch` requests.
- 2b3ef4a: Tool steps accept provider input schemas that use `format` keywords such as `date-time`. A Sentry `search-issues` step failed before it reached Sentry.
- c06262b: Each claimed tool-step call and concurrency repair gets its own span, and idle scans create none.
- e71cded: Accepts top-level workflow `outputs`. The document schema takes a map from output names to templates, with the job-outputs entry limit. The new `workflow.outputs` expression field reads the `jobs`, `inputs`, `vars`, `workflow`, `run`, `trigger`, and `event` contexts. Definitions normalize the map into `WorkflowModel.outputs` and `outputTypes` and type-check each output against the declared job outputs, so a reference to an undeclared job output is a sync error. The workflow outputs runtime now evaluates under the `workflow.outputs` field.
- 2ab4025: Workflows can link to their runs. `run.url` in the run context, `event.run.url` on Shipfox run and job events, and `url` on the `start_workflow_run` output hold the run permalink, built from `CLIENT_BASE_URL`. Replaying a Shipfox event stored without `run.url` fills it in. The `slack-dispatcher` and `report-failed-runs` templates use these links instead of `https://app.shipfox.io/runs/`.
- Updated dependencies [be33fe6]
- Updated dependencies [af0e24b]
- Updated dependencies [e99aa97]
- Updated dependencies [6b4ae32]
- Updated dependencies [af3b91f]
- Updated dependencies [46f78a0]
- Updated dependencies [eadd377]
- Updated dependencies [7d20d04]
- Updated dependencies [dc2bd62]
- Updated dependencies [3f1363c]
- Updated dependencies [8937e15]
- Updated dependencies [1f218c4]
- Updated dependencies [16d18f4]
- Updated dependencies [7ea02c4]
- Updated dependencies [6e53525]
- Updated dependencies [8b8b37b]
- Updated dependencies [a2fbdd3]
- Updated dependencies [8a926dc]
- Updated dependencies [ba1aff7]
- Updated dependencies [2526ccf]
- Updated dependencies [807ae57]
- Updated dependencies [4c789ca]
- Updated dependencies [c4f486b]
- Updated dependencies [d273097]
- Updated dependencies [7fddfc5]
- Updated dependencies [e087b95]
- Updated dependencies [68d6cd6]
- Updated dependencies [476e3b1]
- Updated dependencies [9d7c039]
- Updated dependencies [eb3f034]
- Updated dependencies [c0b814f]
- Updated dependencies [0654280]
- Updated dependencies [3b3e25c]
- Updated dependencies [fb79732]
- Updated dependencies [027e401]
- Updated dependencies [2e5a311]
- Updated dependencies [f05ecde]
- Updated dependencies [2d009f4]
- Updated dependencies [4273dad]
- Updated dependencies [8a4f3d8]
- Updated dependencies [b9a53b2]
- Updated dependencies [3b63397]
- Updated dependencies [b76c004]
- Updated dependencies [0b661c9]
- Updated dependencies [dc8065c]
- Updated dependencies [39c5466]
- Updated dependencies [c06262b]
- Updated dependencies [24ea599]
- Updated dependencies [205afb5]
- Updated dependencies [dcd0b79]
- Updated dependencies [cfd75e4]
- Updated dependencies [a73e712]
- Updated dependencies [9e173c3]
- Updated dependencies [f432fd2]
- Updated dependencies [b64fff6]
- Updated dependencies [f769d90]
- Updated dependencies [593142d]
- Updated dependencies [f1f520f]
- Updated dependencies [cfe6ce6]
- Updated dependencies [ab66d1e]
- Updated dependencies [ef7cf4a]
- Updated dependencies [f7e0fb7]
- Updated dependencies [8872f36]
- Updated dependencies [a99c11b]
- Updated dependencies [fc455ac]
- Updated dependencies [67e55ea]
- Updated dependencies [ecc70c2]
- Updated dependencies [6b01f3d]
- Updated dependencies [af3b91f]
- Updated dependencies [e40ec8b]
- Updated dependencies [c06262b]
- Updated dependencies [e08530c]
- Updated dependencies [e560f69]
- Updated dependencies [21c993b]
- Updated dependencies [3869c1d]
- Updated dependencies [c06262b]
- Updated dependencies [a15e118]
- Updated dependencies [4e3497b]
- Updated dependencies [4aad893]
- Updated dependencies [6c0d6bd]
- Updated dependencies [eca4c27]
- Updated dependencies [d657853]
- Updated dependencies [c6f2ae3]
- Updated dependencies [fafbe84]
- Updated dependencies [737c625]
- Updated dependencies [cb411b1]
- Updated dependencies [090d6a0]
- Updated dependencies [507915a]
- Updated dependencies [2c36559]
- Updated dependencies [9906470]
- Updated dependencies [0b661c9]
- Updated dependencies [3aa5d7a]
- Updated dependencies [395e11d]
- Updated dependencies [2128c1e]
- Updated dependencies [041ae63]
- Updated dependencies [a429987]
- Updated dependencies [ebe3ac1]
- Updated dependencies [42829e8]
- Updated dependencies [3f1363c]
- Updated dependencies [94e77bc]
- Updated dependencies [2100749]
- Updated dependencies [9bac67e]
- Updated dependencies [f6bc1f4]
- Updated dependencies [96ac908]
- Updated dependencies [651153a]
- Updated dependencies [dbe45d5]
- Updated dependencies [e2e561c]
- Updated dependencies [dd20040]
- Updated dependencies [daf0208]
- Updated dependencies [00dd046]
- Updated dependencies [9485c57]
- Updated dependencies [a32c90c]
- Updated dependencies [82f2480]
- Updated dependencies [0b2af13]
- Updated dependencies [3c8db4c]
- Updated dependencies [4c8f870]
- Updated dependencies [0b661c9]
- Updated dependencies [e71cded]
- Updated dependencies [6b2a308]
- Updated dependencies [2ab4025]
- Updated dependencies [0b661c9]
- Updated dependencies [70e6983]
- Updated dependencies [89a6cc7]
  - @shipfox/workflow-document@4.0.0
  - @shipfox/api-definitions-dto@34.0.0
  - @shipfox/api-workflows-dto@34.0.0
  - @shipfox/api-secrets-dto@34.0.0
  - @shipfox/expression@2.12.0
  - @shipfox/api-workspaces-dto@34.0.0
  - @shipfox/api-projects-dto@34.0.0
  - @shipfox/api-auth-dto@34.0.0
  - @shipfox/api-agent-dto@34.0.0
  - @shipfox/api-runners-dto@34.0.0
  - @shipfox/api-auth-context@34.0.0
  - @shipfox/api-integration-core-dto@34.0.0
  - @shipfox/api-integration-shipfox-dto@34.0.0
  - @shipfox/node-postgres@0.6.0
  - @shipfox/node-fastify@0.5.0
  - @shipfox/node-module@1.2.0
  - @shipfox/node-outbox@0.3.0
  - @shipfox/node-opentelemetry@0.7.0
  - @shipfox/policy-notice@0.1.0
  - @shipfox/api-logs-dto@34.0.0
  - @shipfox/node-temporal@0.6.0
  - @shipfox/node-drizzle@0.3.7
  - @shipfox/node-error-monitoring@0.4.1

## 33.0.0

### Patch Changes

- f24d9cd: Recover completed attempts' session claims before dispatching the next writer, so delayed background releases do not fail sequential agent steps.
- Updated dependencies [f24d9cd]
  - @shipfox/api-agent-dto@33.0.0
  - @shipfox/api-workflows-dto@33.0.0

## 32.2.1

### Patch Changes

- f01a070: Show tool steps with the same integration icons, labels, results, and error status as agent tool calls. Record invocation timing for log durations.

## 32.2.0

### Patch Changes

- Updated dependencies [3494bf1]
  - @shipfox/workflow-document@3.10.0
  - @shipfox/api-agent-dto@32.2.0
  - @shipfox/api-definitions-dto@32.2.0
  - @shipfox/expression@2.11.2
  - @shipfox/api-workflows-dto@32.2.0

## 32.1.0

### Patch Changes

- Updated dependencies [fd261c8]
  - @shipfox/api-agent-dto@32.1.0
  - @shipfox/api-workflows-dto@32.1.0

## 32.0.0

### Minor Changes

- 212c6b6: Adds a shared tabbed inspector for workflow runs and job executions with compact summary facts and a simplified usage breakdown. The run overview DTO gains `secret_inputs`, which lists each secret input's name and source key but never its value. Adds `@shipfox/react-ui/inspector`: the inspector host, header, facts, tabs, and full-width sections with property rows, plus the `background-inspector-*` surface tokens.

### Patch Changes

- Updated dependencies [e87d5a9]
- Updated dependencies [212c6b6]
  - @shipfox/api-agent-dto@32.0.0
  - @shipfox/api-workflows-dto@32.0.0

## 31.0.0

### Minor Changes

- bab2786: Expose configured runner catalog names through the workflows contract and API.
- c5c7fa3: Workflow definitions can now reference `${{ secrets.inputs.X }}` for step secret bindings. The step secrets pull resolves inputs pinned on the workflow run.

### Patch Changes

- Updated dependencies [17d86bf]
- Updated dependencies [da1114b]
- Updated dependencies [792fc53]
- Updated dependencies [3633ccc]
- Updated dependencies [07ca907]
- Updated dependencies [bab2786]
- Updated dependencies [c5c7fa3]
- Updated dependencies [9e170c7]
- Updated dependencies [bcd9232]
- Updated dependencies [bd03ee1]
  - @shipfox/workflow-document@3.9.0
  - @shipfox/api-integration-core-dto@31.0.0
  - @shipfox/api-agent-dto@31.0.0
  - @shipfox/expression@2.11.1
  - @shipfox/api-workflows-dto@31.0.0
  - @shipfox/api-secrets-dto@31.0.0
  - @shipfox/api-definitions-dto@31.0.0

## 30.0.0

### Minor Changes

- b734fcf: Store secret input references on workflow runs and expose them on run detail responses.

### Patch Changes

- ce729ec: Rejects interpolated secret input names and destinations before a workflow run starts.
- f05d344: Adds the flag-gated Notion provider scaffold. The stored-request contract accepts the Notion webhook route. The seed contract requires UUID identifiers. Workflow failure annotations show the Notion provider name.
- Updated dependencies [c0c5653]
- Updated dependencies [f05d344]
- Updated dependencies [b734fcf]
- Updated dependencies [92b30aa]
  - @shipfox/api-secrets-dto@30.0.0
  - @shipfox/api-integration-core-dto@30.0.0
  - @shipfox/api-workflows-dto@30.0.0
  - @shipfox/expression@2.11.0
  - @shipfox/api-definitions-dto@30.0.0

## 29.1.0

### Minor Changes

- d12820f: Publishes complete canonical workflow and step identity through managed inference credentials.

### Patch Changes

- 27ba71a: Shows unresolved workflow configuration fields and references in failure annotations.
- Updated dependencies [3431ccc]
- Updated dependencies [d12820f]
- Updated dependencies [cbc2ee8]
- Updated dependencies [58b576b]
  - @shipfox/api-workspaces-dto@29.1.0
  - @shipfox/api-agent-dto@29.1.0
  - @shipfox/api-auth-dto@29.1.0
  - @shipfox/api-auth-context@29.1.0
  - @shipfox/api-workflows-dto@29.1.0

## 29.0.0

### Major Changes

- e7a8fe4: Removes rerun concurrency confirmation and applies the current concurrency policy atomically when creating the next attempt.
- b891938: Backfills NULL job snapshots to false and denies renewable-inference credential resolution with runner-capability-required when a runner lacks the capability.

### Patch Changes

- 883bcda: Reduces database round trips for workflow run overviews.
- 4d2e493: Measures workflow run access phases and avoids hydrating full run payloads on routes that only need access scope.
- f4f1f10: Preserves full PostgreSQL timestamp precision in cursor pagination, so records are no longer skipped when their timestamps differ only at sub-millisecond precision.
- Updated dependencies [a34066f]
- Updated dependencies [e7a8fe4]
- Updated dependencies [d1c07bb]
- Updated dependencies [f4f1f10]
- Updated dependencies [f571b7f]
- Updated dependencies [8e74f71]
- Updated dependencies [0e7c381]
- Updated dependencies [b891938]
  - @shipfox/node-fastify@0.4.7
  - @shipfox/api-workflows-dto@29.0.0
  - @shipfox/api-runners-dto@29.0.0
  - @shipfox/node-drizzle@0.3.6
  - @shipfox/workflow-document@3.8.0
  - @shipfox/api-logs-dto@29.0.0
  - @shipfox/annotations-dto@29.0.0
  - @shipfox/api-agent-dto@29.0.0
  - @shipfox/api-auth-context@29.0.0
  - @shipfox/node-module@1.1.2
  - @shipfox/api-definitions-dto@29.0.0
  - @shipfox/expression@2.10.1

## 28.0.0

### Minor Changes

- e8f0212: Adds the confirm_concurrency_impact request field and the concurrency-impact response with affected attempts and planned effects for workflow reruns.
- 7067bc3: Shows which workflow run started a child run in the run list and overview.

### Patch Changes

- 48ec879: Removes `reportFresh` from runner capability results. Job claims and workflow warnings now use the stored session manifest without freshness checks.
- d62e17e: Repairs drifted workflow concurrency state: releases claims left by finished runs, promotes waiting runs, cancels superseded attempts, and restarts orchestrations that never started.
- Updated dependencies [48ec879]
- Updated dependencies [e8f0212]
- Updated dependencies [d62e17e]
- Updated dependencies [7067bc3]
  - @shipfox/api-runners-dto@28.0.0
  - @shipfox/api-workflows-dto@28.0.0

## 27.2.0

### Minor Changes

- 6ad8c2e: `startDevRun` accepts an optional `devSource.definitionSource` (`'ref' | 'local'`, default `'ref'`), and dev-run sources expose `definition_source`, so callers can tell whether a workflow definition came from the repository at a ref or was sent in the request.
- 45cf692: Adds workflow run causation fields and fixed depth and tree-size limits for child runs.

### Patch Changes

- Updated dependencies [0827733]
- Updated dependencies [ef44a76]
- Updated dependencies [6ad8c2e]
- Updated dependencies [6bc8256]
- Updated dependencies [45cf692]
- Updated dependencies [f5bc959]
  - @shipfox/api-integration-core-dto@27.2.0
  - @shipfox/api-definitions-dto@27.2.0
  - @shipfox/api-workflows-dto@27.2.0
  - @shipfox/api-runners-dto@27.2.0

## 27.1.0

### Minor Changes

- e0b7bd1: Carries workflow lineage and name snapshots through job-execution and inference Usage records.

### Patch Changes

- Updated dependencies [e0b7bd1]
  - @shipfox/api-workflows-dto@27.1.0

## 27.0.0

### Patch Changes

- 7b45939: Allows an initial checkout to replace a rejected credential generation with a fresh exact-scope credential for the lease token's current step.
- Updated dependencies [45c9598]
  - @shipfox/api-agent-dto@27.0.0
  - @shipfox/api-workflows-dto@27.0.0

## 26.1.0

### Minor Changes

- cb99d51: Exposes model stream recovery rows and provider-category failures across workflow, log, Agent Access, and client contracts.

### Patch Changes

- bbf540e: Cancels superseded workflow run attempts and active concurrency holders requested by newer cancel-in-progress runs.
- bf6a5c5: Workflow runs now wait for a concurrency slot before starting; their run timeout begins only after they acquire the slot.
- Updated dependencies [db12613]
- Updated dependencies [cb99d51]
- Updated dependencies [c2c97ac]
  - @shipfox/api-definitions-dto@26.1.0
  - @shipfox/api-workflows-dto@26.1.0
  - @shipfox/api-logs-dto@26.1.0
  - @shipfox/node-error-monitoring@0.4.0
  - @shipfox/node-fastify@0.4.6
  - @shipfox/node-module@1.1.1
  - @shipfox/node-temporal@0.5.2
  - @shipfox/api-auth-context@26.1.0

## 26.0.0

### Minor Changes

- d7cb4a7: Adds durable workflow concurrency claims with latest-wins admission and supersession of an earlier waiter.
- da717b1: Exposes workflow concurrency state and affected run attempts through workflow run APIs.
- 5cb4279: Joins initial workflow runs to resolved concurrency groups with transactional claim admission, claim outbox events, and accurate concurrency-group interpolation errors.
- aafce80: The workflow run-attempt-created event now optionally carries `actorUserId`.

### Patch Changes

- 575cbc1: Add the flag-gated ClickUp integration provider scaffold, installation persistence, token storage, cleanup hooks, and E2E connection seed route.
- 2ebf33d: Refreshes run-creation step expressions for each workflow rerun.
- Updated dependencies [6eaacf0]
- Updated dependencies [795eee2]
- Updated dependencies [da717b1]
- Updated dependencies [db054aa]
- Updated dependencies [4a75c26]
- Updated dependencies [7acec37]
- Updated dependencies [5cb4279]
- Updated dependencies [fb73bca]
- Updated dependencies [8229356]
- Updated dependencies [aafce80]
  - @shipfox/api-integration-core-dto@26.0.0
  - @shipfox/api-logs-dto@26.0.0
  - @shipfox/api-workflows-dto@26.0.0
  - @shipfox/api-auth-dto@26.0.0
  - @shipfox/api-auth-context@26.0.0
  - @shipfox/api-workspaces-dto@26.0.0
  - @shipfox/node-module@1.1.0

## 25.0.0

### Minor Changes

- 00e2ce4: Publish lease_expired, provider_lost, and lifecycle_violation as job execution status reasons; add the optional cause field and RunnerJobLossCauseDto/runnerJobLossCauseSchema to the lease-expired event, with runner_lost fallback when provider state is unavailable.
- 9e8b007: Adds an optional `gate_max_attempts` field to the compact step summary, and
  shows effective gate restart limits and chronological gate attempt numbers in
  workflow run details.

### Patch Changes

- 701df29: Expose missing renewable inference capability as a declared, bounded runtime credential error.
- Updated dependencies [00e2ce4]
- Updated dependencies [bba82ae]
- Updated dependencies [9e8b007]
- Updated dependencies [701df29]
  - @shipfox/api-runners-dto@25.0.0
  - @shipfox/api-workflows-dto@25.0.0
  - @shipfox/api-auth-dto@25.0.0
  - @shipfox/api-auth-context@25.0.0
  - @shipfox/api-agent-dto@25.0.0

## 24.2.0

### Minor Changes

- ec852c4: Expose the authored restarting gate key on `step.restart.from` for dispatch-time workflow expressions.
- 011d9ec: Adds workspace-scoped `cancelWorkflowRun` and `rerunWorkflowRun` commands: cancellation returns the run `id`, `currentAttempt`, and `status`, while rerun returns `id`, `attempt`, and `status`; both report attempt mismatches, cancellation rejects terminal runs, and rerun rejects non-terminal runs or failed-mode requests when there are no failed or cancelled jobs. `startRunFromTrigger` optionally reports `deduplicated` for an already-started run and surfaces workspace admission errors.
- 3cc2ffb: Propagates concurrency supersession through workflow termination events and runner shutdown reconciliation.
- 6100626: Adds stable gate failure reasons and restart diagnostics across workflow APIs, Agent Access, and the client.

### Patch Changes

- Updated dependencies [ec852c4]
- Updated dependencies [011d9ec]
- Updated dependencies [3cc2ffb]
- Updated dependencies [6100626]
  - @shipfox/expression@2.10.0
  - @shipfox/api-workflows-dto@24.2.0
  - @shipfox/api-runners-dto@24.2.0
  - @shipfox/api-definitions-dto@24.2.0

## 24.1.1

### Patch Changes

- Updated dependencies [0c00509]
  - @shipfox/expression@2.9.2
  - @shipfox/api-definitions-dto@24.1.1
  - @shipfox/api-workflows-dto@24.1.1

## 24.1.0

### Minor Changes

- cdc9dfe: Adds the waiting workflow run status to DTO, database, server, and client contracts without producing it during run creation.

### Patch Changes

- d559bdb: Persist the effective gate attempt limit for each run, defaulting new Definitions to five while retaining the legacy three-attempt fallback for older run data.
- c730a68: Adds `timed_out` and `run_cancelled` log records, exposes terminal causes on step-attempt termination events, and renders timeout, cancellation, and runner loss distinctly.
- Updated dependencies [edc3705]
- Updated dependencies [d559bdb]
- Updated dependencies [c730a68]
- Updated dependencies [34b5267]
- Updated dependencies [dd01977]
- Updated dependencies [cdc9dfe]
  - @shipfox/api-auth-dto@24.1.0
  - @shipfox/workflow-document@3.7.0
  - @shipfox/api-definitions-dto@24.1.0
  - @shipfox/api-logs-dto@24.1.0
  - @shipfox/api-workflows-dto@24.1.0
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

### Patch Changes

- 33f575e: Workflows honors materialized gate limits from 1 through 1,000 with WORKFLOW_GATE_MAX_ATTEMPTS_MAX and preserves the three-attempt behavior when the limit is absent.
- 86b6e05: Continue named agent sessions from the latest session segment when workflows retry a step.
- Updated dependencies [10f23f7]
- Updated dependencies [33f575e]
- Updated dependencies [a43b3c5]
  - @shipfox/expression@2.9.0
  - @shipfox/workflow-document@3.6.0
  - @shipfox/api-auth-dto@24.0.0
  - @shipfox/api-definitions-dto@24.0.0
  - @shipfox/api-agent-dto@24.0.0
  - @shipfox/api-auth-context@24.0.0
  - @shipfox/api-workflows-dto@24.0.0

## 23.2.0

### Patch Changes

- @shipfox/api-auth-dto@23.2.0
- @shipfox/api-projects-dto@23.2.0
- @shipfox/api-workspaces-dto@23.2.0
- @shipfox/api-auth-context@23.2.0

## 23.1.0

### Patch Changes

- Updated dependencies [038a38c]
  - @shipfox/api-workspaces-dto@23.1.0
  - @shipfox/api-auth-context@23.1.0

## 23.0.0

### Minor Changes

- bd5acd2: Bounds listener filter snapshots to referenced context paths and a separate 512 KiB `filter_snapshot` execution payload limit.

### Patch Changes

- 8b357d4: Fixes false oversized errors for CEL integer tool outputs. Tool mappings now reject non-finite values, unsafe integers, unsupported objects, cycles, and excessive nesting.
- 2cd82bc: Stops writing duplicate legacy trigger-event arrays for new listener executions.
- Updated dependencies [7fed218]
- Updated dependencies [bd5acd2]
  - @shipfox/api-auth-context@23.0.0
  - @shipfox/api-auth-dto@23.0.0
  - @shipfox/api-workflows-dto@23.0.0
  - @shipfox/expression@2.8.0
  - @shipfox/api-definitions-dto@23.0.0
  - @shipfox/api-agent-dto@21.1.0
  - @shipfox/annotations-dto@20.3.0
  - @shipfox/api-integration-core-dto@22.0.0
  - @shipfox/api-logs-dto@20.0.0
  - @shipfox/api-projects-dto@21.0.0
  - @shipfox/api-runners-dto@21.1.0
  - @shipfox/api-secrets-dto@12.0.0
  - @shipfox/api-workspaces-dto@15.0.0
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

### Major Changes

- e390533: Removes the legacy `GET /workflows/runs/:id` detail route.
  It removes `workflowRunDetailResponseSchema`, `jobDtoSchema`, `jobExecutionDtoSchema`, and their public exports, including `workflowRunJobDetailDtoSchema`, `workflowRunJobExecutionDetailDtoSchema`, `workflowRunStepDetailDtoSchema`, `WorkflowRunJobDetailDto`, `WorkflowRunJobExecutionDetailDto`, and `WorkflowRunStepDetailDto`.
  It also removes `WORKFLOW_RUN_DETAIL_REQUEST_KIND_HEADER`, `WORKFLOW_RUN_DETAIL_REQUEST_KINDS`, `WorkflowRunDetailRequestKind`, `getWorkflowRunDetail`, `useWorkflowRunQuery`, `workflowRunQueryOptions`, and `WorkflowRunDetail` exports.
  Run-attempt lists now return `{items, next_cursor}` with a default limit of 25; run lists omit trigger payloads, inputs, and source snapshots.
  Run-list and job-detail display statuses now use API-provided bounded status fields.
  Consumers must migrate to bounded overviews, paginated job and attempt resources, and dedicated job or step-attempt detail reads.
  Direct HTTP consumers of the removed detail route receive 404 responses without a compatibility signal.

### Patch Changes

- c392dfb: Adds typed synthetic listener dispatch and shared payload limits for production-shaped E2E coverage.
- 6fd8c7b: Omit absent cursors from workflow annotation page reads.
- 4f825e3: Validates direct workflow tool inputs with the server-selected method so method-specific schemas accept the correct arguments.
- Updated dependencies [c392dfb]
- Updated dependencies [e390533]
  - @shipfox/api-integration-core-dto@22.0.0
  - @shipfox/api-workflows-dto@22.0.0

## 21.2.0

### Minor Changes

- 1f2c634: Adds bounded workflow execution trigger-event list and detail reads with stable
  pagination and size-limited payload previews. Existing execution context reads
  continue to support historical executions.
- 12cc22e: Adds bounded Agent Access tools for workflow execution trigger-event diagnostics.

### Patch Changes

- 8407bd1: Rejects oversized listener fire deliveries without suppressing matching resolve events.
- 351569e: Exposes the current workflow run attempt as `run.attempt` in expressions and reruns. Deploy compatible workers before adopting this field in persisted expressions because older builds omit it and cause those expressions to fail closed.
- Updated dependencies [0745878]
- Updated dependencies [1f2c634]
- Updated dependencies [12cc22e]
- Updated dependencies [8407bd1]
- Updated dependencies [351569e]
- Updated dependencies [41e1cfc]
  - @shipfox/node-module@1.0.10
  - @shipfox/node-temporal@0.5.0
  - @shipfox/api-workflows-dto@21.2.0
  - @shipfox/expression@2.7.0
  - @shipfox/api-definitions-dto@21.2.0

## 21.1.0

### Minor Changes

- 01af160: Separates execution payload limits from diagnostic read limits and bounds oversized workflow failures.
- 6fac62f: Adds runner identity to the `runners.job.claimed` projection on `job_executions`, and adds `workspaceId`, `projectId`, `definitionId`, `jobKey`, `queuedAt`, `startedAt`, and runner identity to `workflows.job_execution.terminated` and `jobKey`, `definitionId`, and `runNumber` to `workflows.job_execution.queued`, so a consumer can build a complete usage record from a single event.

### Patch Changes

- 2d17e02: Accepts listener executions that fit the bounded execution payload limit and keeps overflow trigger events pending.
- f534da6: Snapshots renewable inference eligibility at job claim and rejects runtime credentials after cancellation or attempt replacement.
- 8a98a87: Bounds workflow step-attempt detail responses and adds typed oversized-field reasons to step-attempt diagnostics.
- 843f6c3: Persists listener event byte metadata and terminal outcomes for consumed, honored, rejected, and abandoned events.
- ae3526f: Consumes listener events in exact application-sized batches and keeps legacy oversized heads pending, surfacing an alert instead of a retry loop.
- Updated dependencies [01af160]
- Updated dependencies [be1c862]
- Updated dependencies [f534da6]
- Updated dependencies [8a98a87]
- Updated dependencies [6fac62f]
  - @shipfox/api-workflows-dto@21.1.0
  - @shipfox/api-runners-dto@21.1.0
  - @shipfox/api-agent-dto@21.1.0

## 21.0.0

### Minor Changes

- 12f7b10: Exposes bounded workflow-run diagnostics through the Workflows inter-module contract.
- ff45d70: Adds optional `projectId`, `jobId`, `jobExecutionId`, `stepId`, and `attempt` fields to managed provider credential resolution.
- e225f5e: Adds strict direct integration-tool surfaces and explicit discovery mode to Pi workflow configuration.

### Patch Changes

- 32e9fa0: Carries named agent sessions into failed-job reruns.
- Updated dependencies [8825c23]
- Updated dependencies [12f7b10]
- Updated dependencies [ff45d70]
- Updated dependencies [b6298b8]
- Updated dependencies [e225f5e]
- Updated dependencies [879f227]
- Updated dependencies [cffa62d]
- Updated dependencies [5886bf2]
- Updated dependencies [b5d02d1]
- Updated dependencies [32e9fa0]
  - @shipfox/expression@2.6.1
  - @shipfox/api-workflows-dto@21.0.0
  - @shipfox/api-agent-dto@21.0.0
  - @shipfox/api-integration-core-dto@21.0.0
  - @shipfox/api-definitions-dto@21.0.0
  - @shipfox/workflow-document@3.5.0
  - @shipfox/api-projects-dto@21.0.0
  - @shipfox/api-runners-dto@21.0.0

## 20.4.0

### Minor Changes

- 9a66057: Adds lazy source, execution-context, and step-diagnostic workflow APIs with bounded diagnostic reads and writes.

### Patch Changes

- Updated dependencies [9a66057]
- Updated dependencies [0b32d1a]
  - @shipfox/api-workflows-dto@20.4.0
  - @shipfox/api-auth-context@20.4.0
  - @shipfox/api-auth-dto@20.4.0

## 20.3.0

### Patch Changes

- 813a284: Adds CEL `dyn` support for unknown-shaped tool and JSON outputs, preserves their native runtime values, and keeps listener snapshots compatible during rolling deploys.
- 47ce13d: Advertises renewable Git support from verified managed runner images and warns self-hosted users when persisted checkout credentials cannot renew.
- Updated dependencies [813a284]
- Updated dependencies [47f6024]
- Updated dependencies [da6fbb8]
  - @shipfox/expression@2.6.0
  - @shipfox/api-workflows-dto@20.3.0
  - @shipfox/annotations-dto@20.3.0
  - @shipfox/api-definitions-dto@20.3.0

## 20.2.0

### Minor Changes

- ff63dcd: Adds the workflow-run annotations endpoint with job, execution, and step ancestry, plus the job-explanations endpoint for failed or skipped jobs without execution rows.
- 61f7b94: Adds bounded selected-job detail and cursor-paginated execution, step, and step-attempt API responses, and caps persisted error and gate text in workflow-run responses.

### Patch Changes

- b96c9cb: Improves workflow failure annotations with actionable recovery guidance while hiding internal reason codes, exit codes, and raw runtime messages.
- eb45f1d: Names mapped tool output failures with their mapping key and a bounded CEL diagnostic.
- Updated dependencies [ba481d6]
- Updated dependencies [ff63dcd]
- Updated dependencies [646373f]
- Updated dependencies [eb45f1d]
- Updated dependencies [61f7b94]
  - @shipfox/node-fastify@0.4.4
  - @shipfox/annotations-dto@20.2.0
  - @shipfox/api-workflows-dto@20.2.0
  - @shipfox/expression@2.5.0
  - @shipfox/api-auth-context@20.2.0
  - @shipfox/node-module@1.0.9
  - @shipfox/api-definitions-dto@20.2.0

## 20.1.0

### Minor Changes

- 6207ce3: Adds bounded workflow run overview and job-page APIs with capped execution counts and source-snapshot enforcement.

### Patch Changes

- 5efaf93: Allow workflow run detail URLs to resolve a single run selection from a deeply nested attempt, job, execution, or step ID without requiring the intermediate ancestry in the URL.
- ab6de5d: Enforces tool-step gates against provider outputs without an exit code and keeps failed provider calls from rewinding.
- Updated dependencies [2bf937b]
- Updated dependencies [ebe5c00]
- Updated dependencies [6207ce3]
- Updated dependencies [3ec04b0]
- Updated dependencies [5efaf93]
- Updated dependencies [bb334f7]
- Updated dependencies [7467ee6]
  - @shipfox/api-auth-context@20.1.0
  - @shipfox/api-auth-dto@20.1.0
  - @shipfox/api-definitions-dto@20.1.0
  - @shipfox/api-workflows-dto@20.1.0
  - @shipfox/api-agent-dto@20.1.0
  - @shipfox/api-integration-core-dto@20.1.0

## 20.0.0

### Major Changes

- b5c8329: Execute queued workflow tool steps on the server instead of the client.

  The API Workflows module now requires the Logs inter-module client and starts a
  server-side tool-step executor by default. Set
  `WORKFLOWS_TOOL_STEP_EXECUTOR_ENABLED=false` before restarting an API process
  to disable new tool-step calls. Older API builds do not run this executor, so
  drain or settle pending tool invocations before rolling back this release.

### Patch Changes

- ec39327: Projects checkout resolution now requires a project ID and no longer accepts repository names. Checkout requests authorize the repository target before issuing credentials. Repository declarations remain valid without a project association.
- 2881385: Preserve successful provider outcomes when tool output mapping fails.
- fdfa0b2: Add the `WORKFLOW_RUN_DETAIL_REQUEST_KIND_HEADER` request-kind header and `WorkflowRunDetailRequestKind` type for workflow-run detail reads; client-workflows detail requests now send the request kind, which the API records as initial versus polling.
- af4a765: Add the workflow-run lineage head endpoint and opt-in cursor pagination for attempt history while preserving the legacy no-query response.
- 70f2eed: Adds checkout credential renewal to the setup checkout-token response via `refresh-at`/`on-rejection` renewal modes and accepts an optional `rejected_generation` when renewing.
- f2bf4bf: Adds bounded metrics for server-executed workflow tool invocations.
- Updated dependencies [ca7eb23]
- Updated dependencies [9113421]
- Updated dependencies [794f834]
- Updated dependencies [46ae6a8]
- Updated dependencies [db83e6c]
- Updated dependencies [ec39327]
- Updated dependencies [533b968]
- Updated dependencies [351f02c]
- Updated dependencies [fdfa0b2]
- Updated dependencies [af4a765]
- Updated dependencies [70f2eed]
  - @shipfox/api-logs-dto@20.0.0
  - @shipfox/api-auth-dto@20.0.0
  - @shipfox/api-runners-dto@20.0.0
  - @shipfox/workflow-document@3.4.0
  - @shipfox/api-integration-core-dto@20.0.0
  - @shipfox/api-projects-dto@20.0.0
  - @shipfox/api-workflows-dto@20.0.0
  - @shipfox/api-auth-context@20.0.0
  - @shipfox/api-agent-dto@20.0.0
  - @shipfox/api-definitions-dto@20.0.0
  - @shipfox/expression@2.4.3

## 19.0.0

### Minor Changes

- 34ebe6a: Expose workspace-scoped workflow execution and annotation read contracts.
- 93918a4: Server workflow tool steps now return a `wait` protocol while a scheduled tool call is pending, and clients recognize the new `tool_error`, `tool_config_invalid`, and `invocation_interrupted` step error reasons.
- a61dda2: Materializes integration tool steps with typed inputs, mapped outputs, and frozen catalog metadata.

### Patch Changes

- c07c8e2: Preserves the pinned agent harness across workflow reruns.
- b416c4c: Preserves existing package behavior while simplifying internal control flow.
- 75a54d1: Adds the repository authorization contract with exact-ID/name target resolution and its authorization error codes. Checkout now surfaces repository-authorization failures as not-granted (404), ambiguous (409), and store-unavailable (503) errors.
- Updated dependencies [34ebe6a]
- Updated dependencies [c07c8e2]
- Updated dependencies [b416c4c]
- Updated dependencies [5af8d52]
- Updated dependencies [a52cd6d]
- Updated dependencies [461e3a0]
- Updated dependencies [a225bf8]
- Updated dependencies [75a54d1]
- Updated dependencies [b2e6556]
- Updated dependencies [621108c]
- Updated dependencies [cd5fb8f]
- Updated dependencies [93918a4]
  - @shipfox/api-workflows-dto@19.0.0
  - @shipfox/annotations-dto@19.0.0
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
  - @shipfox/api-runners-dto@19.0.0
  - @shipfox/api-auth-dto@19.0.0
  - @shipfox/api-secrets-dto@12.0.0
  - @shipfox/api-workspaces-dto@15.0.0
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

- 151f750: Claims agent sessions at step dispatch and carries the session descriptor:
  - Resolves the session key template at the step-dispatch context site with the same roots as the prompt and calls the agent-module `claimSession` before the step is handed to the runner. A `resume` claim that conflicts with a live attempt, a resolved harness that differs from the session's pinned harness, an invalid resolved key, or an unavailable session registry fails the attempt through the config-evaluation-failure path with one of the new step error reasons: `agent_session_key_invalid`, `agent_session_held`, `agent_session_harness_mismatch`, `agent_session_unavailable`.
  - Embeds the resolved session descriptor `{id, key, mode, segment}` in the step dispatch config and exposes it as a typed nullable `session` field on the step DTO; the attempt config records the descriptor for the UI and audits.

- b2aad90: Adds `generation` and `renewal` checkout-credential fields and `createCheckoutCredentials`, which accepts the frozen connection, stable repository ID, exact permissions, and rejected generation.
- a50e2dc: Expose the `cancellation_reason` field so consumers can distinguish user cancellation from maximum-duration timeouts.

### Patch Changes

- Updated dependencies [151f750]
- Updated dependencies [a6f242c]
- Updated dependencies [fff528a]
- Updated dependencies [60061fb]
- Updated dependencies [b2aad90]
- Updated dependencies [a50e2dc]
- Updated dependencies [242bd21]
- Updated dependencies [defc3e6]
  - @shipfox/api-workflows-dto@18.0.0
  - @shipfox/api-agent-dto@18.0.0
  - @shipfox/api-auth-dto@18.0.0
  - @shipfox/api-runners-dto@18.0.0
  - @shipfox/api-integration-core-dto@18.0.0
  - @shipfox/api-auth-context@18.0.0

## 17.1.0

### Patch Changes

- Updated dependencies [fd6cee5]
  - @shipfox/api-agent-dto@17.1.0
  - @shipfox/api-workflows-dto@17.1.0

## 17.0.0

### Minor Changes

- ed4981e: Adds the lease-authed agent session transcript transport: `GET /runs/jobs/current/steps/:stepId/session` returns the decrypted, still-gzipped head snapshot with manifest headers (or a 204 no-head marker), and `POST .../session?attempt=N&base_segment=S` commits segment `S + 1` under the claim/base CAS with idempotent-retry acks and 409 conflicts. The routes resolve the leased step through a new workflows inter-module method (`getLeasedAgentSessionContext`); the artifact store enforces the session blob cap.

### Patch Changes

- Updated dependencies [a4f56ff]
- Updated dependencies [5ae8b3d]
- Updated dependencies [ed4981e]
- Updated dependencies [a591e8a]
- Updated dependencies [918d84a]
- Updated dependencies [9f898d9]
- Updated dependencies [9f898d9]
- Updated dependencies [9fdba44]
- Updated dependencies [be5fb95]
  - @shipfox/api-auth-context@17.0.0
  - @shipfox/api-auth-dto@17.0.0
  - @shipfox/api-agent-dto@17.0.0
  - @shipfox/api-workflows-dto@17.0.0
  - @shipfox/node-postgres@0.5.1
  - @shipfox/workflow-document@3.3.1
  - @shipfox/node-outbox@0.2.6
  - @shipfox/api-definitions-dto@17.0.0
  - @shipfox/expression@2.4.1

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
  - @shipfox/api-workflows-dto@16.1.0
  - @shipfox/api-definitions-dto@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [568c90b]
- Updated dependencies [03e03c7]
- Updated dependencies [117edfd]
- Updated dependencies [8eda9d4]
  - @shipfox/api-integration-core-dto@16.0.0
  - @shipfox/api-agent-dto@16.0.0
  - @shipfox/workflow-document@3.3.0
  - @shipfox/api-definitions-dto@16.0.0
  - @shipfox/expression@2.4.0
  - @shipfox/api-runners-dto@16.0.0
  - @shipfox/api-workflows-dto@16.0.0

## 15.0.0

### Minor Changes

- af095a4: Adds the `startDevRun` inter-module method that creates a workflow run from an inline model and snapshot with `origin: 'dev'` and dev provenance, numbered by the workflow lineage id. Manual `subscriptionId` and cron `scheduleId` trigger payload fields become optional so a dev trigger can fire without a subscription row.

### Patch Changes

- Updated dependencies [a7804a8]
- Updated dependencies [af095a4]
- Updated dependencies [07410fe]
- Updated dependencies [989eb11]
- Updated dependencies [b7d522a]
- Updated dependencies [050b796]
- Updated dependencies [0b6addb]
  - @shipfox/api-definitions-dto@15.0.0
  - @shipfox/api-workflows-dto@15.0.0
  - @shipfox/api-agent-dto@15.0.0
  - @shipfox/expression@2.3.0
  - @shipfox/workflow-document@3.2.0
  - @shipfox/api-integration-core-dto@15.0.0
  - @shipfox/node-opentelemetry@0.6.5
  - @shipfox/api-auth-dto@15.0.0
  - @shipfox/api-projects-dto@15.0.0
  - @shipfox/api-workspaces-dto@15.0.0
  - @shipfox/node-fastify@0.4.3
  - @shipfox/node-module@1.0.7
  - @shipfox/node-temporal@0.4.6
  - @shipfox/api-auth-context@15.0.0

## 14.0.0

### Minor Changes

- 4f30864: Trigger `event` is now optional end to end. An omitted event subscribes to every event from its source. Explicit events continue to work unchanged. Built-in manual and scheduled triggers use `fire` and `tick`, respectively.
- b766ee3: Adds `origin` and `dev_source` to workflow runs, with an `origin` facet on the run list and aggregates endpoints. Existing runs read as `synced`. Dev runs check out their pinned source commit by default, while same-project replay event commits retain precedence.

### Patch Changes

- 110e8dd: Numbers workflow runs by the workflow lineage id, so runs of one workflow file share a single numbering sequence across definition revisions.
- 5e87483: Validates workflow run provenance (origin and dev_source) at the API boundary; database constraints now only enforce the origin/source relationship.
- Updated dependencies [c0fc35b]
- Updated dependencies [f7b3db8]
- Updated dependencies [69a92c4]
- Updated dependencies [09924ca]
- Updated dependencies [4f30864]
- Updated dependencies [18e9bad]
- Updated dependencies [a4df8d9]
- Updated dependencies [aeaa0de]
- Updated dependencies [c44641f]
- Updated dependencies [1b71a66]
- Updated dependencies [b766ee3]
  - @shipfox/api-definitions-dto@14.0.0
  - @shipfox/api-runners-dto@14.0.0
  - @shipfox/api-agent-dto@14.0.0
  - @shipfox/workflow-document@3.1.0
  - @shipfox/api-workflows-dto@14.0.0
  - @shipfox/api-integration-core-dto@14.0.0
  - @shipfox/api-projects-dto@14.0.0
  - @shipfox/expression@2.2.1

## 13.1.0

### Patch Changes

- 0d3c2e3: Updates @shipfox/client-agent, @shipfox/client-onboarding, and @shipfox/client-workflows to show
  managed inference providers without exposing workspace credential setup, keep workflow examples
  limited to supported models, and explain managed-provider failures in workflow runs.
- ca91dc3: Adds managed-provider runtime credential resolution and lease-scoped wire fields for pi and Claude harnesses.
- Updated dependencies [0d3c2e3]
- Updated dependencies [5c100d6]
- Updated dependencies [ca91dc3]
- Updated dependencies [67aab38]
  - @shipfox/api-agent-dto@13.1.0
  - @shipfox/api-workflows-dto@13.1.0

## 13.0.0

### Patch Changes

- af6b31e: Expose ordered queued and terminal workflow job-execution facts, and release terminal runner reservations once no uncancelled lease remains.
- Updated dependencies [af6b31e]
  - @shipfox/api-runners-dto@13.0.0
  - @shipfox/api-workflows-dto@13.0.0

## 12.7.0

### Minor Changes

- 4df5e37: Workflow run list items and run detail now carry `has_started_job_execution`, reporting whether any
  job execution of the attempt reached a runner. Run surfaces no longer show a client-derived `Queued`
  state: the run list and run detail present the API attempt status and duration, and read the new
  field to label a finished run's duration as run or elapsed time.

### Patch Changes

- Updated dependencies [4df5e37]
  - @shipfox/api-workflows-dto@12.7.0

## 12.6.0

### Minor Changes

- 53b87f0: Distinguish queued and executing jobs in workflow run list status strips.

### Patch Changes

- Updated dependencies [53b87f0]
  - @shipfox/api-workflows-dto@12.6.0

## 12.5.0

### Minor Changes

- 5b1838c: Expose actionable status reasons and messages when materialized job outputs cannot be persisted.

### Patch Changes

- 69940bc: Include measured output sizes and overshoots in job output size errors.
- 41f8f5f: Raises job output limits to 64 KiB per value and 256 KiB total before runner-side cap changes.
- Updated dependencies [5b1838c]
  - @shipfox/api-workflows-dto@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [9e16946]
- Updated dependencies [4fa8526]
  - @shipfox/api-runners-dto@12.4.0

## 12.3.0

### Minor Changes

- 4b0731e: Adds workflow troubleshooting details, evaluation traces, failure annotations, runner context, step output metadata, and lazy paginated annotation summaries.
- a830294: Loads configured runner catalog names when materializing workflow runner labels.

### Patch Changes

- Updated dependencies [4b0731e]
- Updated dependencies [3e7fe76]
  - @shipfox/api-workflows-dto@12.3.0
  - @shipfox/annotations-dto@12.3.0
  - @shipfox/expression@2.2.0
  - @shipfox/api-definitions-dto@12.3.0

## 12.2.0

### Minor Changes

- ce0984d: Preserve structured values when jobs map typed step outputs, normalize them for JSON persistence, and bound materialized job output sizes and entry counts.

### Patch Changes

- 214b8f2: Expose execution and run numeric fields as CEL integers, preserve zero-based execution indices,
  and keep listener filter snapshots aligned with live CEL values after persistence.
- Updated dependencies [78b771c]
- Updated dependencies [7901a60]
- Updated dependencies [df2ed79]
- Updated dependencies [ce0984d]
  - @shipfox/api-runners-dto@12.2.0
  - @shipfox/api-integration-core-dto@12.2.0
  - @shipfox/api-projects-dto@12.2.0
  - @shipfox/runner-labels@0.2.0
  - @shipfox/expression@2.1.0
  - @shipfox/api-workflows-dto@12.2.0
  - @shipfox/workflow-document@3.0.1
  - @shipfox/node-opentelemetry@0.6.4
  - @shipfox/api-definitions-dto@12.2.0
  - @shipfox/api-agent-dto@12.2.0
  - @shipfox/node-fastify@0.4.2
  - @shipfox/node-module@1.0.6
  - @shipfox/node-temporal@0.4.5
  - @shipfox/api-auth-context@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [312a137]
  - @shipfox/api-workflows-dto@12.1.0

## 12.0.0

### Major Changes

- adf07e7: Cut over workflow and job display names to literal-only `name` fields, with runtime interpolation supported through `run_name` and `execution_name`.
- 032d316: Scope checkout credential minting to the currently running checkout step and return its fetch depth.

### Minor Changes

- ee2ce67: Accept a `${{ }}` interpolation in an agent step's `thinking` field. The schema
  still offers the per-harness enum for editor completion, and the dispatcher
  checks the resolved value against the harness levels. An unsupported
  resolved level fails the step.
- 5d2c9cf: Carry checkout steps from workflow normalization through step materialization and surface their setup error category.
- f7939c7: Add resolved checkout details as a dedicated step-report field.
- 9e1d599: Carry first-checkout intent through workflow normalization and step materialization for the upcoming runner checkout execution, including implicit-checkout suppression, checkout opt-out, and position-based primary checkout placement.
- dea1ffd: Expose normalized repository references on listening execution events.
- 285fff2: Persist resolved workflow job execution names and handle dynamic naming failures consistently.
- e44a279: Persist nullable resolved workflow run-name overrides alongside static workflow-name snapshots.
- 54c820e: Add the trigger reference and the current attempt's jobs to each workflow run in the run list response.

  `trigger_reference` carries the repository, ref, commit, and actor a source-control trigger resolved, or null for triggers that resolve none. Jobs arrive as `jobs`, a preview bounded by the new `WORKFLOW_RUN_JOB_PREVIEW_LIMIT`, alongside `job_status_counts` covering every job of the attempt including those past the preview.

- 35a42bd: Resolve run and agent step working directories against the runner job workspace.
- d77baaa: Add per-definition sequential numbers to workflow runs and expose them in the API and expression context.
- c2a8e54: Normalize checkout target fields for step-dispatch resolution, reject unsupported job-level checkout fields, and keep the workflow model and runtime checkout contracts aligned.
- cb0abfa: Expose the normalized trigger project, repository, ref, and commit in workflow context.
- ee2ce67: Split workflow definition facts out of the `run` context into a `workflow` root.
  `run.workflow_name` becomes `workflow.name` and `run.definition_id` becomes
  `workflow.id`, so `workflow` and `run` mirror the `job` and `execution` pair.
  Add `contextRootsForField` to return the readable roots for a predicate or an
  interpolation field without requiring the caller to choose a mechanism. Add
  `workflowContextDocs` as the reader-facing description of every root and property.

### Patch Changes

- 7c4116e: Align predicate property types with their runtime shapes, replace `run.run_name` with `run.workflow_name`, and remove `failed` from `executions` entries.
- 0bb880a: Transition job executions from pending to running when the runner claims them.
- f78740d: Remove Unicode dash punctuation from package prose and source comments.
- 4d246d4: Align predicate validation and runtime evaluation with field-specific context contracts.
- 66f111e: Snapshots referenced workflow variables for predicate evaluation at run creation.
- 53ce6b2: Materialize primary checkout credential persistence on the setup step.
- 5d267c3: Re-materialize checkout policy from the workflow model when re-running a job.
- 9e39069: Defaults same-project checkout steps to the workflow trigger commit while preserving explicit refs and cross-repository defaults.
- Updated dependencies [ee2ce67]
- Updated dependencies [7c4116e]
- Updated dependencies [5d2c9cf]
- Updated dependencies [e95fdf4]
- Updated dependencies [3d91d1d]
- Updated dependencies [f7939c7]
- Updated dependencies [89f2c18]
- Updated dependencies [045895c]
- Updated dependencies [f78740d]
- Updated dependencies [9e1d599]
- Updated dependencies [dea1ffd]
- Updated dependencies [adf07e7]
- Updated dependencies [94aba88]
- Updated dependencies [3f781ee]
- Updated dependencies [9fdd5e4]
- Updated dependencies [285fff2]
- Updated dependencies [e44a279]
- Updated dependencies [4d246d4]
- Updated dependencies [4eb18b8]
- Updated dependencies [28daafe]
- Updated dependencies [f13e8bb]
- Updated dependencies [9ebc5b4]
- Updated dependencies [4444079]
- Updated dependencies [869a792]
- Updated dependencies [8cc5a36]
- Updated dependencies [54c820e]
- Updated dependencies [35a42bd]
- Updated dependencies [d77baaa]
- Updated dependencies [41d558c]
- Updated dependencies [032d316]
- Updated dependencies [c2a8e54]
- Updated dependencies [54c820e]
- Updated dependencies [cb0abfa]
- Updated dependencies [ee2ce67]
- Updated dependencies [7f90b0c]
- Updated dependencies [e1efaee]
  - @shipfox/workflow-document@3.0.0
  - @shipfox/api-definitions-dto@12.0.0
  - @shipfox/api-workflows-dto@12.0.0
  - @shipfox/api-agent-dto@12.0.0
  - @shipfox/expression@2.0.0
  - @shipfox/api-auth-dto@12.0.0
  - @shipfox/inter-module@0.2.3
  - @shipfox/node-fastify@0.4.1
  - @shipfox/node-module@1.0.5
  - @shipfox/api-workspaces-dto@12.0.0
  - @shipfox/api-projects-dto@12.0.0
  - @shipfox/api-integration-core-dto@12.0.0
  - @shipfox/node-postgres@0.5.0
  - @shipfox/api-auth-context@12.0.0
  - @shipfox/annotations-dto@12.0.0
  - @shipfox/api-runners-dto@12.0.0
  - @shipfox/api-secrets-dto@12.0.0
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-outbox@0.2.6

## 11.0.0

### Major Changes

- 25158c8: Carry workspace lifecycle status in JWT membership claims and enforce suspended or inactive access at the stateless workspace gate while keeping access-token verification stateless.

  `getAuthenticatedSessionContext()` now reads refresh-session metadata from verified access-token claims without checking active refresh-session state; revoking a refresh session does not invalidate an already-issued access token.

### Patch Changes

- Updated dependencies [71d9ba4]
- Updated dependencies [25158c8]
  - @shipfox/expression@1.2.1
  - @shipfox/api-auth-context@11.0.0
  - @shipfox/api-workspaces-dto@11.0.0
  - @shipfox/api-definitions-dto@11.0.0

## 10.2.0

### Patch Changes

- Updated dependencies [c9a188d]
- Updated dependencies [8678943]
- Updated dependencies [95d1456]
- Updated dependencies [0773b85]
- Updated dependencies [6be5a54]
- Updated dependencies [07e7371]
  - @shipfox/api-runners-dto@10.2.0
  - @shipfox/api-auth-dto@10.2.0
  - @shipfox/api-workspaces-dto@10.2.0
  - @shipfox/api-auth-context@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [88ae689]
- Updated dependencies [fb34b6a]
  - @shipfox/api-projects-dto@10.1.0
  - @shipfox/api-auth-dto@10.1.0
  - @shipfox/api-auth-context@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [6054364]
- Updated dependencies [74f9e31]
- Updated dependencies [22bf8a2]
- Updated dependencies [a713231]
- Updated dependencies [43ce975]
- Updated dependencies [e9280fc]
- Updated dependencies [837bf5d]
- Updated dependencies [3f5610b]
  - @shipfox/api-auth-dto@10.0.0
  - @shipfox/node-fastify@0.4.0
  - @shipfox/api-workflows-dto@10.0.0
  - @shipfox/expression@1.2.0
  - @shipfox/api-agent-dto@10.0.0
  - @shipfox/api-workspaces-dto@10.0.0
  - @shipfox/api-projects-dto@10.0.0
  - @shipfox/api-runners-dto@10.0.0
  - @shipfox/api-auth-context@10.0.0
  - @shipfox/node-module@1.0.4
  - @shipfox/api-definitions-dto@10.0.0
  - @shipfox/annotations-dto@9.0.2
  - @shipfox/api-integration-core-dto@9.0.2
  - @shipfox/api-secrets-dto@9.0.2
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

### Minor Changes

- 6017e56: Reject new workflow work for suspended or deleted workspaces with stable non-retryable results.

### Patch Changes

- Updated dependencies [10cf63c]
- Updated dependencies [4425c6d]
- Updated dependencies [6017e56]
- Updated dependencies [7b6a409]
  - @shipfox/api-auth-dto@9.3.0
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/api-workflows-dto@9.3.0
  - @shipfox/api-workspaces-dto@9.3.0
  - @shipfox/api-auth-context@9.3.0
  - @shipfox/node-fastify@0.3.4
  - @shipfox/node-module@1.0.3
  - @shipfox/node-temporal@0.4.4

## 9.2.0

### Patch Changes

- Updated dependencies [456c884]
  - @shipfox/api-auth-dto@9.2.0
  - @shipfox/api-projects-dto@9.2.0
  - @shipfox/api-auth-context@9.2.0

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
  - @shipfox/annotations-dto@9.0.2
  - @shipfox/api-agent-dto@9.0.2
  - @shipfox/api-auth-context@9.0.2
  - @shipfox/api-auth-dto@9.0.2
  - @shipfox/api-definitions-dto@9.0.2
  - @shipfox/api-integration-core-dto@9.0.2
  - @shipfox/api-projects-dto@9.0.2
  - @shipfox/api-runners-dto@9.0.2
  - @shipfox/api-secrets-dto@9.0.2
  - @shipfox/api-workflows-dto@9.0.2
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
- a041e25: Moves lease-state validation behind the Runners inter-module boundary.
- Updated dependencies [8436596]
- Updated dependencies [475ce59]
- Updated dependencies [154e03f]
  - @shipfox/api-secrets-dto@9.0.1
  - @shipfox/runner-labels@0.1.2
  - @shipfox/expression@1.1.4
  - @shipfox/workflow-document@2.1.2
  - @shipfox/annotations-dto@9.0.1
  - @shipfox/api-agent-dto@9.0.1
  - @shipfox/api-auth-context@9.0.1
  - @shipfox/api-auth-dto@9.0.1
  - @shipfox/api-definitions-dto@9.0.1
  - @shipfox/api-integration-core-dto@9.0.1
  - @shipfox/api-projects-dto@9.0.1
  - @shipfox/api-runners-dto@9.0.1
  - @shipfox/api-workflows-dto@9.0.1
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

- 074e7b3: Decouples workflow test fixtures from peer API implementations.
- 46aa52f: Closes remaining API package-boundary exceptions and moves model-provider policy behind the Agent implementation boundary.
- a9f9c57: Decouples Definitions and Workflows tests from peer implementation packages and databases.
- Updated dependencies [46aa52f]
- Updated dependencies [02974d6]
- Updated dependencies [4a6d124]
  - @shipfox/api-agent-dto@9.0.0
  - @shipfox/api-integration-core-dto@9.0.0
  - @shipfox/api-secrets-dto@9.0.0
  - @shipfox/api-auth-context@9.0.0
  - @shipfox/annotations-dto@6.0.0
  - @shipfox/api-auth-dto@7.1.0
  - @shipfox/api-definitions-dto@6.0.0
  - @shipfox/api-projects-dto@8.0.0
  - @shipfox/api-runners-dto@7.0.1
  - @shipfox/api-workflows-dto@9.0.0
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

### Patch Changes

- de559bb: Moves Agent validation policy behind a versioned inter-module catalog and injects it into Definitions normalization.
- b15f3a7: Removes Auth implementation dependencies from consumer test boundaries.
- Updated dependencies [de559bb]
- Updated dependencies [b15f3a7]
- Updated dependencies [7f227c6]
  - @shipfox/api-agent-dto@8.0.0
  - @shipfox/api-runners@8.0.0
  - @shipfox/api-integration-core-dto@8.0.0
  - @shipfox/api-projects-dto@8.0.0
  - @shipfox/api-workflows-dto@8.0.0

## 7.1.0

### Patch Changes

- Updated dependencies [ac42c96]
- Updated dependencies [769d919]
- Updated dependencies [6ce08c0]
  - @shipfox/node-error-monitoring@0.2.0
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-module@0.5.0
  - @shipfox/node-temporal@0.4.0
  - @shipfox/api-runners@7.1.0
  - @shipfox/api-auth-dto@7.1.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/api-auth-context@7.1.0
  - @shipfox/api-projects@7.1.0

## 7.0.2

### Patch Changes

- @shipfox/api-runners@7.0.2

## 7.0.1

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.
- Updated dependencies [ffc7fc9]
  - @shipfox/api-runners@7.0.1
  - @shipfox/api-runners-dto@7.0.1

## 7.0.0

### Patch Changes

- Updated dependencies [bc7cfdc]
  - @shipfox/api-runners@7.0.0
  - @shipfox/api-runners-dto@7.0.0

## 6.0.0

### Major Changes

- a8f0545: Adds the versioned Definitions workflow snapshot contract and registered presentation.
- 9006b75: Adds the Runners inter-module contract and requires the injected Runners client when composing Workflows.

### Minor Changes

- 23563de: Moves Triggers to the injected Workflows inter-module contract with stable run idempotency and listener delivery commands.
- a42b575: Exposes Secrets through its inter-module contract and migrates Agent, integrations, and Workflows consumers.
- 23a4dc2: Moves Logs and Integrations to injected Workflows inter-module clients with minimal log and leased agent-tool queries.

### Patch Changes

- 0bb82a4: Adds the Agent and Integrations inter-module APIs, moving Workflows agent configuration, runtime credential resolution, and integration consumers behind producer-owned clients.
- 9cb2442: Moves workflow capability-warning annotations behind the producer-owned inter-module API.
- b70f920: Adds assigned runner activation and descendant provisioner revocation.
- 112c0fa: Adds the Auth inter-module token-minting contract and removes Auth implementation and configuration coupling from its consumers.
- f73da5d: Enforces bounded API context imports and routes inter-module consumers through producer contracts.
- Updated dependencies [e52513c]
- Updated dependencies [a8f0545]
- Updated dependencies [0bb82a4]
- Updated dependencies [9cb2442]
- Updated dependencies [b70f920]
- Updated dependencies [23563de]
- Updated dependencies [6a52909]
- Updated dependencies [e6eba5b]
- Updated dependencies [54ce48b]
- Updated dependencies [add4c77]
- Updated dependencies [9006b75]
- Updated dependencies [3cda0c6]
- Updated dependencies [ba2e3dc]
- Updated dependencies [f4bc2eb]
- Updated dependencies [c0162b0]
- Updated dependencies [7ac43a4]
- Updated dependencies [f262539]
- Updated dependencies [a01e917]
- Updated dependencies [3bb4e26]
- Updated dependencies [a42b575]
- Updated dependencies [112c0fa]
- Updated dependencies [8bdc149]
- Updated dependencies [795e293]
- Updated dependencies [e10c829]
- Updated dependencies [f73da5d]
- Updated dependencies [3810996]
- Updated dependencies [23a4dc2]
- Updated dependencies [b00ed29]
- Updated dependencies [8aa7cd3]
- Updated dependencies [4a91956]
- Updated dependencies [81f9544]
- Updated dependencies [4604a06]
- Updated dependencies [6741be8]
  - @shipfox/api-runners@6.0.0
  - @shipfox/api-runners-dto@6.0.0
  - @shipfox/api-definitions-dto@6.0.0
  - @shipfox/api-agent-dto@6.0.0
  - @shipfox/api-integration-core-dto@6.0.0
  - @shipfox/api-projects@6.0.0
  - @shipfox/annotations-dto@6.0.0
  - @shipfox/api-workflows-dto@6.0.0
  - @shipfox/api-auth-dto@6.0.0
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
  - @shipfox/annotations@5.0.0
  - @shipfox/api-agent@5.0.0
  - @shipfox/api-agent-dto@5.0.0
  - @shipfox/api-auth@5.0.0
  - @shipfox/api-auth-context@5.0.0
  - @shipfox/api-definitions@5.0.0
  - @shipfox/api-projects@5.0.0
  - @shipfox/api-runners@5.0.0
  - @shipfox/api-runners-dto@5.0.0
  - @shipfox/api-secrets@5.0.0
  - @shipfox/api-secrets-dto@5.0.0
  - @shipfox/api-workflows-dto@5.0.0
  - @shipfox/expression@1.1.3
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-error-monitoring@0.1.3
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-module@0.3.2
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-outbox@0.2.3
  - @shipfox/node-postgres@0.4.2
  - @shipfox/node-temporal@0.3.1
  - @shipfox/runner-labels@0.1.1

## 4.0.0

### Patch Changes

- Updated dependencies [5d129d6]
- Updated dependencies [67176d4]
- Updated dependencies [0b0a9c2]
- Updated dependencies [bbba3b7]
- Updated dependencies [1951293]
  - @shipfox/api-integration-core@4.0.0
  - @shipfox/api-auth@4.0.0
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/api-definitions@4.0.0
  - @shipfox/api-projects@4.0.0
  - @shipfox/annotations@4.0.0
  - @shipfox/api-runners@4.0.0
  - @shipfox/api-agent@4.0.0
  - @shipfox/api-secrets@4.0.0
  - @shipfox/node-module@0.3.1
  - @shipfox/node-outbox@0.2.2

## 3.0.0

### Patch Changes

- 7a71e7d: Aligns published dependency ranges with the workspace catalog policy.
- 08fc93b: Adds prebuilt production Temporal workflow bundles to API packages and removes runtime workflow compilation.
- Updated dependencies [3976f8c]
- Updated dependencies [c5ee18f]
- Updated dependencies [7a71e7d]
- Updated dependencies [08fc93b]
  - @shipfox/node-module@0.3.0
  - @shipfox/api-auth@3.0.0
  - @shipfox/node-temporal@0.3.0
  - @shipfox/api-agent@3.0.0
  - @shipfox/api-definitions@3.0.0
  - @shipfox/api-integration-core@3.0.0
  - @shipfox/api-projects@3.0.0
  - @shipfox/api-runners@3.0.0
  - @shipfox/expression@1.1.2
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/annotations@3.0.0
  - @shipfox/api-secrets@3.0.0
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
- Updated dependencies [c31a7e0]
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/node-module@0.2.0
  - @shipfox/api-integration-core@2.0.0
  - @shipfox/node-temporal@0.2.0
  - @shipfox/api-auth@2.0.0
  - @shipfox/annotations@2.0.0
  - @shipfox/api-agent@2.0.0
  - @shipfox/api-agent-dto@2.0.0
  - @shipfox/api-auth-context@2.0.0
  - @shipfox/api-definitions@2.0.0
  - @shipfox/api-projects@2.0.0
  - @shipfox/api-runners@2.0.0
  - @shipfox/api-runners-dto@2.0.0
  - @shipfox/api-secrets@2.0.0
  - @shipfox/api-secrets-dto@2.0.0
  - @shipfox/api-workflows-dto@2.0.0
  - @shipfox/runner-labels@0.1.0
  - @shipfox/expression@1.1.1
  - @shipfox/node-drizzle@0.2.1
  - @shipfox/node-error-monitoring@0.1.2
  - @shipfox/node-fastify@0.2.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/node-outbox@0.2.1
  - @shipfox/node-postgres@0.4.1

## 0.1.2

### Patch Changes

- Updated dependencies [705dd43]
  - @shipfox/node-outbox@0.2.0
  - @shipfox/api-auth@0.1.2
  - @shipfox/api-definitions@0.1.2
  - @shipfox/api-integration-core@0.1.2
  - @shipfox/api-projects@0.1.2
  - @shipfox/api-runners@0.1.2
  - @shipfox/api-secrets@0.1.2
  - @shipfox/node-module@0.1.2
  - @shipfox/annotations@0.0.3
  - @shipfox/api-agent@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [ec75cd5]
- Updated dependencies [6a1fb54]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/node-postgres@0.4.0
  - @shipfox/api-agent@0.1.1
  - @shipfox/annotations@0.0.2
  - @shipfox/api-auth@0.1.1
  - @shipfox/api-definitions@0.1.1
  - @shipfox/api-integration-core@0.1.1
  - @shipfox/api-projects@0.1.1
  - @shipfox/api-runners@0.1.1
  - @shipfox/api-secrets@0.1.1
  - @shipfox/node-module@0.1.1
  - @shipfox/node-outbox@0.1.1

## 0.1.0

### Minor Changes

- 5c18360: Durable gate restart: a failing gate's `on_failure.restart_from` now records the failed attempt, rewinds the job's step projection from the named earlier step back to pending (opening fresh attempts), and leaves the job running so it re-executes from there — all in one transaction with the report. A per-step attempt cap (default 3) bounds restart loops, exhausting to a `restart_exhausted` failure. Adds the `workflows.step.restart_enqueued` event.
- a56748d: Adds ingestion-time agent session parsing with a stored canonical SessionView read endpoint and workflow harness lookup.
- 7a9943d: Adds the backend contract for per-step execution: job claims mint a lease token for the step API, step reports carry attempts and exit codes, and workflow completion can be signalled through the workflows outbox. The runner-side step loop is intentionally owned by the follow-up runner protocol work.
- 736249b: Expose step attempts in the read API: the run-detail endpoint now returns `current_attempt` on each step plus its per-attempt history (`attempts[]`, with status, exit code, gate result and restart reason), so a restarted step's attempts are visible.
- 2bc5595: Adds workflow-run cancellation across the API, orchestration queue cleanup, event contract, and run-page cancel action.
- f9f059e: Cut the runner protocol over to per-step pull/report and remove the job-atomic path.

  The job workflow now terminates on two signals: `job-finished` (raised by
  `recordStepResult` on step exhaustion) and `job-lease-expired` (raised by the new
  `runners.job.lease_expired` subscriber). A precedence ladder keeps a genuinely
  finished job from being failed by a late lease expiry, and the lease-expiry branch
  re-derives the outcome from the authoritative step projection in a single
  transaction (server state is the final gate). On finish the workflow releases the
  lease via `releaseJob` (deleting both the running and any orphaned pending row);
  release is best-effort so a Scheduling outage never blocks the run DAG.

  Removed the atomic path end to end: the runner `POST /runners/jobs/:jobId/complete`
  route, the `RUNNER_JOB_COMPLETED` event, `finalizeRunningJob`/`completeJob`, the
  `applyStepResults*` apply path and its workflow subscriber, and the dead
  `jobPayload*`/`complete-job` DTO schemas. The runner now parses the step-less claim
  response, and `claimPendingJob` drops an orphan pending row instead of poison-looping.

  Internal breaking change (deleted exported DTOs/events and a runner route, plus a
  Temporal signal rename) consumed only within this monorepo; backend and agent ship
  together.

- f98c2be: [api/workflows] Add the lease-authed `POST /runs/jobs/current/checkout-token` endpoint. The runner exchanges its job lease for short-lived, read-only repository checkout credentials. The job's checkout intent is resolved server-side from the authoritative `jobId` claim (`job -> run -> project` source metadata) and minted on demand via the integration service's `createCheckoutSpec()`; no credential material is ever stored on the job/run or queued. `checkoutTokenResponseSchema.auth` stays optional so credential-free providers can return a public clone URL with no token, and `integrationRouteErrorHandler` is exported from `@shipfox/api-integration-core` so the route reuses the shared provider-error mapping.
- e9396c9: Give every runner-dispatched job a synthetic "Set up job" step at position 0 (à la GitHub Actions), so failures that happen around the user steps — workspace preparation today, the repository checkout next — are reported through the existing per-step protocol instead of hanging the job until the lease/timeout fires. The runner prepares the per-job workspace inside this step and reports the outcome; a failed setup flows through the existing fail-job cascade, finalizing the job `failed` in seconds with no user step run.

  Extends `stepErrorDtoSchema` with an optional machine-readable `reason` (`workspace_prep_failed`, `git_unavailable`, `checkout_*`, `setup_aborted`) and a `category` (`setup` | `user`). The runner reports `reason`; the server derives `category` from the step type on read (the runner is an untrusted boundary). The restart resolver now skips the synthetic step so a user step named "Set up job" can never rewind setup mid-job.

- 139e3be: Execute step gates at runtime: evaluate `gate.success_if` (CEL) against the step's exit code to decide pass/fail — overriding the raw command status — and record the gate result on the attempt. A failing gate fails the job; a missing exit code or an evaluation error fails closed as a plain command failure; a failing gate with `on_failure.restart_from` fails closed with a structured `restart_unsupported` error until durable restart lands.
- c652a68: Add a single reliable job-terminal event: `workflows.job.terminated` is now written in the same transaction as every terminal job-status flip (normal completion, DAG cancellation, lease-expiry resolution, and timeout), and the run-level `workflows.workflow_run.terminated` is emitted the same way. All workflows event names are aligned on one `WORKFLOWS_<entity>_<verb>` scheme, so the run and job terminal events read as the same event at two scopes.

  Internal breaking change (`WORKFLOWS_JOB_COMPLETED` → `WORKFLOWS_JOB_STEPS_SETTLED`, `WORKFLOW_RUN_*` → `WORKFLOWS_WORKFLOW_RUN_*`, with matching DTO type renames) consumed only within this monorepo.

- 121b42e: Track per-step execution attempts: add a `step_attempts` history table and a `steps.current_attempt` column, open a running attempt at dispatch and finalize it at report, and make step-result reporting attempt-aware (idempotent duplicate reports, rejected future attempts, no-op stale attempts).
- c0a883c: Adds the runner-facing per-step endpoints (`POST /runs/jobs/current/steps/next` and `/steps/:stepId/report`) authed by a locally-verified job lease token, with the matching request/response schemas.
- d69b164: Adds workflow run attempt lineage APIs and a run summary switcher for navigating rerun attempts.
- b74f635: Adds workflow run interpolation context resolution while preserving authored step configuration for reruns and diagnostics.
- e699508: Adds first-class skipped workflow jobs with persisted status reasons across API DTOs, orchestration, events, and client run views.

### Patch Changes

- eb40964: Add an inline `agent` workflow step that the runner runs with the pi harness. A step is an agent step when it carries `model` + `prompt` and no `run`; it takes a free-text `model`, a single `prompt`, and an optional `thinking` level (default `high`). The step runs to process-success (the agent ran to completion) and reports through the existing step protocol with no runner/backend protocol change, so change quality is judged by a downstream `run` + `gate` step. v1 does not persist the agent's work (no diff, commit, or PR).
- 2c156d2: Extracts pure workflow runtime scheduling decisions behind the existing workflows orchestration host.
- f788565: Unifies workflow step config field resolution and agent default completion across creation and dispatch fill sites.
- b1f57d1: Moves agent model provider credentials onto the shared secrets store while keeping provider config metadata and runtime resolution behavior intact.
- 97162dd: Resolves model provider, model, and thinking defaults at workflow run creation using workspace and instance configuration.
- b694b09: Add the per-step progression domain service (`nextStepForJob`, `recordStepResult`) and its guarded DB primitives over the existing `steps` table. Dormant until the per-step runner protocol is wired into the HTTP and orchestration layers; no runtime behavior changes yet.
- c47be09: Reshape Scheduling around runner job leases. Jobs are now enqueued with `workflowRunId`, `workflowRunAttemptId`, `jobId`, and `jobExecutionId`; the claim route mints a job lease token and returns the same workflow/job identity tuple. The stuck-job detector emits `runners.job.lease_expired` with that tuple when a lease expires.
- ae7a63c: Adds daily dispatched outbox row retention with bounded cleanup batches and retention indexes on module outbox tables.
- e250c4c: Propagates `projectId` end-to-end into the job lease token. Workflows sources the `{workspaceId, projectId, workflowRunId, workflowRunAttemptId, jobId, jobExecutionId}` identity tuple and threads it through the runner pending/running job tables and lease claims. This is lease-shape groundwork for per-project log-ingest authorization; the stream-stamping consumer lands separately.
- b525dcd: Let an agent workflow step pick its pi provider with an optional free-text `provider` field (default `anthropic`), threaded to the runner's pi model lookup, and split agent-step failures into a user-fixable `agent_config_invalid` reason (unknown provider, missing runner credentials, wrong provider/model pair) versus `agent_invocation_failed` for genuine provider/API errors.
- a982f20: Stop a permanently-broken trigger subscription from starving its siblings or wedging the outbox. Integration dispatch now attempts every matched subscription and classifies each `runWorkflow` failure: a permanent error (deleted definition or project mismatch) is recorded and skipped, while a transient one re-throws so the outbox replays the event and converges. The event reaches a terminal outcome once no transient error remains (`routed` when any run was created, otherwise the new `errored` outcome), with a guarded write that never records `errored` over an event that already produced a run. The manual-fire path records the same terminal outcome, and `@shipfox/api-workflows` exports an `isPermanentRunWorkflowError` classifier. The trigger-events read API (`triggerEventOutcomeSchema`) accepts the new `errored` outcome for serialization and filtering.
- 998eba3: Adds phase-aware workflow context metadata, availability predicates, and creation-phase workflow context assembly for runtime materialization.
- 5327934: Materialize listening job steps per execution instead of during workflow run creation.
- 314e84e: Adds server-side step condition skipping so rejected or errored step predicates finish as skipped without dispatching runner attempts.
- 247cbd6: Adds label-aware runner job claiming with shared runner-label validation and required-label orchestration.
- 795f440: Adds the listener orchestration loop for long-lived listening jobs: durable event draining, one execution per buffered event, resolution on until, listening deadline, or max executions, and a run-timeout backstop that resolves active listeners.
- 3dcd751: Adds listener filter snapshots to job activation events and persists them on listener subscriptions.
- 362b3eb: Scope runner log append authorization to the dispatched step attempt carried by the job lease token.
- 6077301: Adds shared timestamp/id keyset pagination helpers and migrates workflow run and trigger event lists onto them.
- 9c1c947: Colocates workflow phase context assembly and threads phase-tagged evaluation contexts through runtime fill sites.
- d635979: Routes workflow materialization and predicate evaluation through persisted planner segments, replacing resolver exports with planned freeze APIs.
- 3bea87f: Adds a typed `subscriberFactory` that binds each outbox event name to its payload type at construction, so subscriber handlers receive a typed `(payload, event)` and the per-handler `event.payload as X` casts are gone; a private brand makes the factory the only way to build a module subscriber.
- ef1e917: Adds listening-job authoring fields and trusted execution context validation for listening jobs.
  Separates workflow identifiers so internal rows use UUID `id`, authored workflow/job/step
  references use `key`, and UI labels use `name`.
- c6eb2ee: Adds debounced listener-event batching with DB-backed coalescing, max-size chunking, and batch-size metrics.
- f9153e8: Persists parsed workflow models on run attempts so later workflow phases can materialize from the frozen template.
- a8905ed: Splits workflow runtime internals into scheduling and step-config modules without changing behavior.
- 282e66a: Exposes frozen agent integration tool selections as non-secret MCP server descriptors in materialized step config.
- 0dd23a7: Warns on agent tool capability mismatches during dispatch without blocking label-matched runners.
- e1d4972: Evaluate the step gate `success_if` over the `step` self-root (`step.exit_code`, `step.status`) and job `success` over the full typed executions context, both validated against the shared context registry; authored gate expressions move from `exit_code` to `step.exit_code` and job-success now fails closed on a runtime evaluation error.
- f9bf446: Extract the step-report decision into a pure `decideStepTransition` plus a durable `applyStepTransition`, creating the seam where gate evaluation and durable restart will plug in. No behavior change.
- 8ecc121: Track queue/run/finish timing for workflow runs and jobs. Adds nullable `started_at`/`finished_at` to workflow runs and `queued_at`/`started_at`/`finished_at` to jobs, exposed on the run and job DTOs. The runners module emits two new authoritative-timestamp events (`runners.job.queued`, `runners.job.started`) in the same transaction as the enqueue/claim; workflows projects them onto the job row with a first-write-wins `coalesce`, so the at-least-once outbox can redeliver out of order safely. Run `started_at`/`finished_at` and job `finished_at` are stamped in-module at the status transitions. All columns are nullable and eventually consistent, so consumers must treat a missing endpoint as "not yet known" and clamp any duration math.
- d7b9596: Refold the workflows migration baseline and tune its indexes. Drops the redundant `step_attempts(job_execution_id)` index, which was fully covered by the `(job_execution_id, execution_order)` unique index. Adds partial `WHERE status = 'running'` indexes on `workflow_runs` and `job_executions` so the running-depth service gauge counts only active rows instead of sequentially scanning the full history on every scrape. No behavior or API change.
- Updated dependencies [eb40964]
- Updated dependencies [0a6318f]
- Updated dependencies [7bc7498]
- Updated dependencies [5c18360]
- Updated dependencies [067a260]
- Updated dependencies [26fea4b]
- Updated dependencies [0cf66c4]
- Updated dependencies [0948b67]
- Updated dependencies [34ba284]
- Updated dependencies [8100b48]
- Updated dependencies [8f51daf]
- Updated dependencies [3b45d86]
- Updated dependencies [5707d6d]
- Updated dependencies [e689abf]
- Updated dependencies [59ba68b]
- Updated dependencies [7a9943d]
- Updated dependencies [ce3e5ca]
- Updated dependencies [b9c3f32]
- Updated dependencies [2325d76]
- Updated dependencies [89026d5]
- Updated dependencies [d02c5fd]
- Updated dependencies [c17dd6e]
- Updated dependencies [a81b68c]
- Updated dependencies [115655e]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [cdf8989]
- Updated dependencies [5cdfc69]
- Updated dependencies [e47f8da]
- Updated dependencies [736249b]
- Updated dependencies [a68ed61]
- Updated dependencies [2bc5595]
- Updated dependencies [b1f57d1]
- Updated dependencies [1127ba2]
- Updated dependencies [36f871d]
- Updated dependencies [e7b01dd]
- Updated dependencies [de54da2]
- Updated dependencies [d546b88]
- Updated dependencies [58c05ed]
- Updated dependencies [ce062a9]
- Updated dependencies [7b175f5]
- Updated dependencies [7ca4c65]
- Updated dependencies [5bcdbf4]
- Updated dependencies [97162dd]
- Updated dependencies [857879a]
- Updated dependencies [c47be09]
- Updated dependencies [f9f059e]
- Updated dependencies [940696a]
- Updated dependencies [f3614ae]
- Updated dependencies [f98c2be]
- Updated dependencies [e9396c9]
- Updated dependencies [ae7a63c]
- Updated dependencies [5729548]
- Updated dependencies [d245be8]
- Updated dependencies [f92122b]
- Updated dependencies [e250c4c]
- Updated dependencies [b525dcd]
- Updated dependencies [f8f339a]
- Updated dependencies [b0a0e1a]
- Updated dependencies [58f51bd]
- Updated dependencies [570ac69]
- Updated dependencies [857fd73]
- Updated dependencies [aca162b]
- Updated dependencies [1c1fb3e]
- Updated dependencies [7fa8f0b]
- Updated dependencies [998eba3]
- Updated dependencies [3afb7e3]
- Updated dependencies [2617db9]
- Updated dependencies [444ac89]
- Updated dependencies [1daf39a]
- Updated dependencies [247cbd6]
- Updated dependencies [1d98b19]
- Updated dependencies [5823bac]
- Updated dependencies [5d53ed4]
- Updated dependencies [c652a68]
- Updated dependencies [fb64f13]
- Updated dependencies [75520ff]
- Updated dependencies [f47cff8]
- Updated dependencies [62720ea]
- Updated dependencies [b855d6f]
- Updated dependencies [795f440]
- Updated dependencies [3dcd751]
- Updated dependencies [f66f606]
- Updated dependencies [c0a883c]
- Updated dependencies [362b3eb]
- Updated dependencies [e51d464]
- Updated dependencies [b8e49ff]
- Updated dependencies [5b8ed32]
- Updated dependencies [417f128]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [f0afdf8]
- Updated dependencies [9d3b43a]
- Updated dependencies [d635979]
- Updated dependencies [3bea87f]
- Updated dependencies [82d22e4]
- Updated dependencies [d69b164]
- Updated dependencies [69d02e5]
- Updated dependencies [2fb3e87]
- Updated dependencies [e0fee57]
- Updated dependencies [b74f635]
- Updated dependencies [fa67aa3]
- Updated dependencies [9a5aac4]
- Updated dependencies [ef1e917]
- Updated dependencies [51eb38a]
- Updated dependencies [61de795]
- Updated dependencies [88b9793]
- Updated dependencies [e2fbef8]
- Updated dependencies [8ecba0f]
- Updated dependencies [27770eb]
- Updated dependencies [2933c33]
- Updated dependencies [2ad300c]
- Updated dependencies [a314b05]
- Updated dependencies [43fd0c1]
- Updated dependencies [950ebef]
- Updated dependencies [03d9eae]
- Updated dependencies [a5c7562]
- Updated dependencies [6181819]
- Updated dependencies [3ddde91]
- Updated dependencies [1ea2f6a]
- Updated dependencies [e699508]
- Updated dependencies [ad6056b]
- Updated dependencies [8b9c3e0]
- Updated dependencies [282e66a]
- Updated dependencies [0dd23a7]
- Updated dependencies [9c149d1]
- Updated dependencies [e1d4972]
- Updated dependencies [fb64f13]
- Updated dependencies [a856155]
- Updated dependencies [8ecc121]
  - @shipfox/api-definitions@0.1.0
  - @shipfox/api-workflows-dto@0.1.0
  - @shipfox/api-agent@0.1.0
  - @shipfox/expression@1.1.0
  - @shipfox/api-agent-dto@0.1.0
  - @shipfox/api-integration-core@0.1.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/api-runners@0.1.0
  - @shipfox/api-runners-dto@0.1.0
  - @shipfox/api-secrets@0.1.0
  - @shipfox/api-secrets-dto@0.1.0
  - @shipfox/annotations@0.0.1
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/api-auth@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/api-projects@0.1.0
  - @shipfox/node-error-monitoring@0.1.1
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-temporal@0.1.1
  - @shipfox/node-module@0.1.0
  - @shipfox/node-outbox@0.1.0
  - @shipfox/runner-labels@0.0.1
