# @shipfox/api-agent-access-dto

## 34.0.0

### Major Changes

- 5588247: Replaces the `models` list in the `get_workflow_authoring_context` result with `model_count`. The `write-a-workflow` skill now finds models through `list_workspace_models` and writes the chosen `provider`.
- 70e6983: Replaces `suggested_models` in the `get_workflow_template` result with bounded `model_recommendations`, so the response fits the size limit for any workspace catalog.

  Placeholders are grouped by the binding their tested model resolves to. Each group has a mode: `recommended` (the tested model and up to four labelled alternatives), `template_default` (the tested model without scores), `workspace_default` (the tested model is unavailable), or `choose`. Every choice carries its complete binding and `provider_required`.

  `@shipfox/workflow-templates` removes `suggestModels` and the manifest `models.<placeholder>.reference` field; the `# model:` line now records the tested setting. The `create-workflow-from-template` skill confirms models per group through a new `choose-models.md` reference.

### Minor Changes

- af0e24b: Shipfox runs the `post` entry of an action at the end of the job.

  - **Post rows:** a job execution gets one `post` step for each action step that declares `post`, after every authored step, in reverse step order. The row is named `Post <step name>`, has no key, and is skipped with the `main_not_started` reason when its main entry never reached the runner.
  - **Dispatch:** a post runs with the inputs, env, secret bindings, tool grants, state, and exported environment of the last attempt of its main step that reached the runner, also after a gate restart skipped the step.
  - **Job result:** a failed post with `post_failure: warn` leaves the job result and `execution.failed` unchanged. With `fail`, it fails the job.
  - **API:** the step type gains `post`, the step status reason gains `main_not_started`, and a post row in a step summary carries `main_step_id` and `affects_job`. The agent access read tools return the same.

- 46f78a0: Adds `find_workspaces` and `find_projects` to the admin MCP endpoint `POST /mcp/admin`. Both need the `admin-observer` role and no impersonation window. `search` matches part of a name or slug, or an exact ID when it is a UUID. Leave it out to list every workspace or project. `find_workspaces` also filters by `status`. Each project names its `workspace_id` and `workspace_slug` for `start_impersonation`. The admin endpoint now needs a projects client. The Workspaces contract adds `listAdminWorkspaces`, and the Projects contract adds `listAdminProjects`. The `GET /admin/workspaces` and `GET /admin/projects` searches now match slugs as well as names.
- 3f1363c: Agent steps accept `mcp_servers`, a map of stdio MCP servers that the runner starts for the step. The agent sees each server tool as `<name>__<tool>`.

  - **Document:** each entry has a literal `command` and `args`, an `env` map whose values support expressions and secrets, and an optional `include` list. Names use lowercase letters, numbers, and single underscores, with at most 20 characters.
  - **Definitions:** `WorkflowModelAgentStep.customMcpServers` keeps each server with its env templates. A server name that matches the tool prefix of an integration connection on the step is rejected with `agent-mcp-server-name-collision`.
  - **Expressions:** the `agent.mcp_servers.env.value` field accepts server and runner contexts.
  - **Materialized config:** `customMcpServers` holds each server with the env values known at dispatch. An env value that reads a secret becomes a secret binding with the new `mcp_server_env` target, and the step secrets route serves agent steps.
  - **Errors:** a server that does not start fails the step with `agent_mcp_server_unavailable`. A materialization collision with the default connection reports `mcp-server-name-collision`.

- 16d18f4: Adds the admin MCP endpoint `POST /mcp/admin`, mounted when `AGENT_ACCESS_ADMIN_MCP_ENABLED` is `true` (default `false`). It shares the `/mcp` origin guard, rate limiters, envelope, and OAuth resource, and re-checks the caller's administrator role against the database on every call, returning `admin-role-required` on failure. It serves `find_users`, `start_impersonation`, and `stop_impersonation`, plus any tools passed through the new `additionalAdminTools` option. `AgentAccessContext` gains an optional `admin` marker, and the audit log line carries `adminActorId` and `impersonationWindowId`. The customer `/mcp` endpoint is unchanged.
- c3b44a2: Serves every read-only workspace tool on the admin MCP endpoint `POST /mcp/admin`, with the same name and behavior as on `/mcp` plus a required `workspace_id`. Each call requires the `admin-operator` role and an open impersonation window on that workspace; role failures return `admin-role-required`, and calls without an open window return `impersonation-window-closed`. The tool runs as the administrator in the named workspace and never sees `workspace_id`. Action tools and `get_step_log_download` are not served. Audit records include the administrator and the resolved window; closed-window attempts record the administrator and the target workspace.
- 7c11451: Members can list and delete cache entries and read storage usage. The Cache module adds routes to list the scopes and entries of a project, delete one entry or a whole scope, read the stored bytes, limit, project totals, and recent deletions of a workspace, and read and set the retention, which only a workspace admin can change. A dev sandbox is listed with its user. A deletion removes the stored archive and records a `manual` deletion. The Cache contract gains `listCacheEntries`, `getCacheUsage`, and `deleteCacheEntries`. The Shipfox MCP server gains the read tools `list_cache_entries` and `get_cache_usage` and the action tool `delete_cache_entries`. `createCacheModule` now takes a `projects` client, and `createAgentAccessModule` takes an optional `cache` client.
- 807ae57: Reads the `{file: ./path}` parts of an agent `prompt` at the same commit as the workflow YAML and inlines their text into the definition. Sync and dev runs from a ref both read the files. A missing, empty, or unreadable file fails with the new `prompt-file-invalid` sync error code and names the step and the file. A prompt file joins the content hash, so a commit that changes only a prompt file produces a new definition. Workflows without prompt files keep their hash.
- 4c789ca: Adds the `check_workflow` read tool. It checks a pushed or local workflow file and reports how one of its triggers would have handled up to 50 past events. It writes nothing and starts no run.

  - **Tool:** `check_workflow` takes `project_id`, `config_path`, and `ref` or `content`. It also accepts `actions`, `commit`, and a `trigger` with `event_ids`. An invalid definition is a result with `valid: false` and its errors, not an error. Each event gets one result: `matched`, `filtered`, `filter-error`, `event-mismatch`, `payload-unavailable`, or `not-found`. The admin MCP endpoint serves it like the other read tools.
  - **Definitions:** `validateDefinitionAtRef` checks a definition the way `resolveDefinitionAtRef` does, and writes nothing. It requires `workspaceId` and answers `project-not-found` for a project in another workspace.
  - **Triggers:** `checkWorkflow` checks project ownership, then checks events with the same source, event, and filter rules as dispatch. `create_dev_run` with `dry_run: true` uses the same validation, so a dry run writes nothing either.
  - **Skills:** `validate-workflow-change` uses `check_workflow` instead of a dry run.

- c4f486b: Names the cause of a checkout failure. Each refusal now identifies the repository, connection or project it was about, a suspended or removed GitHub App installation has its own `installation-inactive` code, and GitHub's own explanation reaches the step error as `provider_message` and `provider_status`. A missing repository now returns a 422, and a failed token mint is cached for 60 seconds instead of 15 minutes.
- 476e3b1: An `action.yml` can set `steps` instead of `main` to declare a composite action. Sync expands it into the definition model.

  - **Breaking:** `ActionManifest` is now a union of a JavaScript and a composite manifest, so `main` can be `undefined`. Narrow it with `isCompositeActionManifest`. `actionManifestSchema` is a transform, so it no longer exposes `.shape` or `.extend`.
  - **Manifest:** a composite manifest sets `steps` instead of `main`, and has no `runtime`, `post`, or `post_failure`. Its outputs need `value`, and its inputs can set `secret: true`. Inner steps reject `checkout` and `export`, and a tool step needs `connection`. `uses:` and prompt `file:` accept a leading `${{ action.path }}/`. `safeParseActionManifest` rejects composite manifests unless `compositeActions` is set.
  - **Expressions:** `action` is a reserved root, readable only inside a composite action. `buildCompositeScopeEnvironment` types its inner `inputs` and `action`, and `action.outputs` is the field for an output `value`.
  - **Resolution:** composite actions are resolved recursively, at most 5 levels deep. A cycle fails with the new `action-cycle` sync error code, and deeper nesting with `action-nesting-too-deep`. The 20-action limit counts the whole tree, and the content hash covers every action and prompt file in it.
  - **Workflow model:** a `composite` step holds its inner steps, with path ids, scoped `inputs` and `steps`, secret inputs rewritten to the caller's references, and aliases bound to the caller's connections. A nested grant must fit inside its outer alias. Source locations can name the composite file. Snapshots with a composite step use version 6, and `flattenJobSteps` lists a job's steps in run order.

- eb3f034: Step diagnostics name the composite actions that hold a step.

  - **Step attempt detail:** the response gains `parent_step_id` and `step_path`, the step's labels from its outermost composite down to the step, such as `["setup", "lint"]`. A label is the step key, or its name when it has no key.
  - **Stored step errors:** an `if` that cannot be evaluated and a failed background step name an inner step by its key path, such as `setup › lint`.
  - **Failure annotations:** an inner step reads as its key path, as on the run page. Job steps read as before.
  - **MCP:** `get_step_attempt` returns `parent_step_id` and `step_path`.
  - **Limits:** `MAX_ACTION_NESTING_DEPTH` and `MAX_STEP_PATH_LENGTH` are exported from `@shipfox/api-definitions-dto`.

- 9d7c039: `list_workflow_execution_steps` returns the composite action that holds each step.

  - **Parent:** every step carries `parent_step_id`, the id of the `composite` step that holds it, or null for a job step.
  - **Schema:** the step type gains `composite`, and the step status reason gains `composite_skipped`.

- 2e5a311: Dev runs accept action uploads. `POST /dev-runs` and the `create_dev_run` MCP tool take an `actions` field: whole action directories, each replacing the ref's copy of its `uses` path. Both routes accept bodies up to 4 MiB. The `create_dev_run` description tells agents which files to send. The run DTO's `dev_source` gains `local_actions`, the uploaded action paths. It defaults to an empty list for older runs.
- cc644b8: `list_workflow_templates` now marks each role with `from_project`. `get_workflow_template` accepts a project role that matches the project's source provider, and its errors now carry a `message` that names the unknown input, missing role, or invalid provider ID. The tool description and the create-workflow-from-template skill show the expected call shape.
- b9a53b2: Adds `status_reason`, `status_reason_message`, and `outputs` to the run overview attempt. The `shipfox` provider's `get_workflow_run` tool returns them on its attempt, and the agent-access `get_workflow_run` tool returns them on the run.
- dc8065c: Fails a step or job when its `if` can't be evaluated, instead of skipping it. The step error reason is `condition_errored`, and the failure names the cause.
- 205afb5: A failed step attempt shows which `gate.on_failure` rule restarted the job, that no rule applied, or which rule could not be evaluated. The run page and the Agent Access step attempt tools return the same decision, and a step with a rule list shows the attempt limit of the rule its latest restart used. Agent Access no longer blanks the first root of an evaluation trace entry.
- 593142d: Adds `summary`, `job_key` and `step_index` to the step error. A `config_unresolvable` failure now names the field and reason, and the job and step when the failing field belongs to a step. The message no longer carries a definition id. The `get_step_attempt` MCP tool returns the same fields.
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
- e3b9558: Templates can declare optional roles. A role with `optional: true` gives a `question` and a `tradeoff`. When the role is unbound, `composeTemplate` drops its parts. `composeTemplate` now writes the `# shipfox-template:` header from the bound roles, so base workflows must no longer declare it. `templateRoleBindings` lists every supported binding, with each optional role both bound and unbound.

  `list_workflow_templates` returns `optional`, `question`, and `tradeoff` for each role. It computes `compatible` and `missing_providers` from required roles only. `get_workflow_template` accepts optional roles being left out. The create-workflow-from-template skill asks about an optional role only when the workspace has a connection for it.

- 8136245: Adds the paged and filterable `list_workspace_models` MCP read tool.
- 4aad893: Adds machine placement rules for installation provisioning. A policy can now pass `placement.resolve`, and a job that needs a reserved runner label but only matches refused templates fails within one poll with the new `runner_not_allowed` status reason and its notice. The client shows the notice and its action.
- 090d6a0: Composite actions can be published to the registry.

  - **Metadata:** `deriveActionMetadata` records `kind` (`javascript` or `composite`) and marks secret inputs with `secret: true`. Versions published before have no `kind`, and are JavaScript actions.
  - **Bumps:** `computeActionBump` makes a change between a JavaScript and a composite action, or a change of an input's `secret` flag, a major bump.
  - **Nested actions:** `collectCompositeActions` lists the exact registry actions a composite action uses, for the version document's `actions`. It refuses repository paths and `${{ action.path }}/` paths. `COMPOSITE_ACTION_MAX_FILES` and `COMPOSITE_ACTION_MAX_BYTES` bound a composite bundle.
  - **Update notices:** a definition's registry references include the registry actions pinned in the repository composite actions it uses, located at the composite's `action.yml`. Pins inside registry composite actions are left out.
  - **Agent access:** `diff_registry_action` reports `kind_change` and `action_changes`, and its input changes cover `secret`. `get_registry_package` describes the composite fields it returns.

- 76d054a: Adds the `list_registry_packages`, `get_registry_package`, and `diff_registry_action` MCP read tools, so coding agents can browse registry packages and compare two action versions before upgrading.
- 2100749: Adds `continue_on_error` to steps. When such a step's own work fails, the step still ends `failed`, but its failure does not count for `run_after`, `execution.failed`, or the job result. Gate restarts run first, and the flag applies to the final failure. It does not cover a step that cannot start, such as an `if` that cannot be evaluated, or a job that times out.

  - **Workflow model:** a step carries `continueOnError: true` when set. A model with such a step is stored as snapshot version 7. Sync rejects the field on a step that uses a composite action.
  - **Storage:** the steps table gains `continue_on_error`, and step attempts gain `failure_ignored`.
  - **API:** the step status reason gains `failure_ignored`. Every step in a job detail carries `affects_job`, and an attempt that `continue_on_error` covered carries `failure_ignored: true`. The agent access read tools accept the new status reason.
  - **Run page and annotations:** an ignored failure shows as a warning, like a post with `post_failure: warn`, and its failure card is a warning. The job page opens on the first failure that counts.

- 00dd046: Definition sync reads the actions that workflows reference with `uses`, at the same commit as the workflows. It stores their snapshots before it applies the definitions. Sync accepts `uses` only while `DEFINITION_ACTIONS_ENABLED` is on.

  - **Change detection:** a workflow with actions hashes its YAML together with the digests of its actions, so a commit that changes only action code produces a new definition. Workflows without actions keep their YAML-only hash.
  - **Sync error codes:** the sync state error code enums add `action-not-found`, `action-invalid`, `action-too-large`, and `action-unsupported-file`, with a migration for `definitions_sync_error_code`. Manifest diagnostics name the `action.yml` path as their file.
  - **Warnings:** a relative import that does not resolve inside an action gives an `action-import-unresolved` warning on the importing file.

- 15e9d33: `get_workflow_template` accepts `options`, such as `{"pr_mode": "ready"}`, and returns `workflow_yaml` with only the chosen option blocks. The header keeps the legacy form. A call with an unknown option or choice explains the valid ones. The result also carries the manifest's `writes` and `prerequisites` as authored.

  The create-workflow-from-template skill (revision 14) passes the answers as `options` and takes the applicable writes and prerequisites from the result. The template guides no longer repeat their prerequisites and expected writes.

- a341ba5: `get_workflow_run_source` lets agents read a long workflow file in line ranges. A reply holds up to 96 KiB, up from 16 KiB, and is cut between lines. Each reply gives `start_line`, `end_line`, and `total_lines`. When lines remain, it also gives `next_from_line`; pass that as the new `from_line` input to read the next range.
- b121f14: Adds `GET /workspaces/:workspaceId/workflow-templates` for workspace members. It lists workflow templates grouped as `try_now`, `starts_on_event`, or `needs_connection`, ordered by template rank, each with its providers, missing providers, and setup prompt. The response schema is `listWorkspaceWorkflowTemplatesResponseSchema`. The MCP server instructions now tell agents to follow the `create-workflow-from-template` skill when the user asks to create, set up, or suggest a workflow.

### Patch Changes

- 3869c1d: Fail queued job executions that are not claimed before the configured queue timeout and start execution timeouts from the persisted claim timestamp.
- 3e8ff99: Manifest v2 makes slots, secrets, and variables described objects; replaces `start_label` with required `starts`; and adds `keywords`, `flow`, `writes`, `prerequisites`, and `related`. It removes manifest `id`, `revision`, `added_at`, and `rank`; the loader supplies identity and compatibility metadata beside the manifest.
- a9d6c18: Limits `get_workflow_run` `wait_seconds` to 45 seconds. Longer waits sent nothing for 60 seconds, so load balancers and MCP clients cut them off. The tool description says that a wait returns early when the run finishes or a job starts listening. A wait now stops when the client disconnects, and the audit records that call as `client-disconnected` instead of `success`. Tools receive the request's abort signal.
- Updated dependencies [be33fe6]
- Updated dependencies [7d20d04]
- Updated dependencies [3f1363c]
- Updated dependencies [8937e15]
- Updated dependencies [807ae57]
- Updated dependencies [4c789ca]
- Updated dependencies [476e3b1]
- Updated dependencies [eb3f034]
- Updated dependencies [3b3e25c]
- Updated dependencies [fb79732]
- Updated dependencies [f05ecde]
- Updated dependencies [dcd0b79]
- Updated dependencies [f1f520f]
- Updated dependencies [8872f36]
- Updated dependencies [67e55ea]
- Updated dependencies [af3b91f]
- Updated dependencies [d657853]
- Updated dependencies [090d6a0]
- Updated dependencies [a509c87]
- Updated dependencies [150d735]
- Updated dependencies [c8857f4]
- Updated dependencies [76fbfe9]
- Updated dependencies [7517867]
- Updated dependencies [3aa5d7a]
- Updated dependencies [2100749]
- Updated dependencies [f6bc1f4]
- Updated dependencies [651153a]
- Updated dependencies [dbe45d5]
- Updated dependencies [00dd046]
- Updated dependencies [6b2a308]
  - @shipfox/api-definitions-dto@34.0.0
  - @shipfox/registry-format@0.1.0
  - @shipfox/api-logs-dto@34.0.0

## 33.1.0

### Minor Changes

- 62e1ef4: Serves Shipfox documentation as cached MCP resources and adds the `search_docs` tool.

## 33.0.0

### Major Changes

- f03324a: Replaces model profiles and `resolved_models` with `suggested_models` in template results. It lists available model and thinking choices and ranks qualified measured combinations by cost.
- fe68025: Serve embedded workflow skills as MCP resources with an index, manifest, and audited reads.

  Remove `get_workflow_setup_guide` from the public MCP contract. The entry point is inactive, and no consumer outside this repository uses the tool.

  Point the first workflow prompt at the template skill.

### Minor Changes

- ed5fe9f: Adds bounded wait support to `get_workflow_run` so callers can follow terminal or listening runs without polling.

## 32.2.0

### Minor Changes

- 3494bf1: Adds a `default` thinking option that requests the provider default without applying workspace or deployment overrides.

## 32.0.0

### Major Changes

- e87d5a9: Replaces singular model reference values with measured variants per supported thinking level in workspace model reads.

## 31.0.0

### Minor Changes

- 2954fac: Adds workspace-bound tools for discovering and composing first-party workflow templates.
- 792fc53: Adds model reference data, pricing, harness settings, and attribution to workspace model reads.
- 0f2bf90: Adds model profiles and workspace-resolved model selections to workflow template results.
- 0ab7a16: Adds optional run permalinks to the MCP run-tool result schemas.
- 85f3d47: Adds shape-only event-trigger checks and reports whether a replay event was checked.
- 14f786a: Add the `get_workflow_authoring_context` tool for reading workspace workflow-authoring facts.

## 29.0.0

### Minor Changes

- 86ad2b7: Adds dry-run validation to the `create_dev_run` agent tool so workflows can be checked against a past event before starting a run.

### Patch Changes

- Updated dependencies [8e74f71]
  - @shipfox/api-logs-dto@29.0.0

## 28.0.0

### Minor Changes

- f081104: Adds local workflow content, actionable refusal details, and provenance warnings to the `create_dev_run` agent tool.

### Patch Changes

- c2f1aab: Allows workflow runs to fire manual triggers with parent-run causation and workflow trigger history.

## 26.1.0

### Minor Changes

- cb99d51: Exposes model stream recovery rows and provider-category failures across workflow, log, Agent Access, and client contracts.

### Patch Changes

- Updated dependencies [cb99d51]
  - @shipfox/api-logs-dto@26.1.0

## 26.0.0

### Minor Changes

- a8ff016: Adds bounded error details, exposes state-changing action tools in tools/list with their destructiveHint, idempotentHint, and openWorldHint annotations, and limits action calls to 10 per credential per minute on top of the existing shared window.
- 86ba951: Adds MCP tools for discovering integration connections and their bounded tool and event catalogs, and exposes each project's resolved source connection in list_projects results.
- b22c120: Adds the `get_step_log_download` MCP tool for stream-bound step-log downloads.
- e78d21a: Adds dormant agent-access action tools with bounded inputs, retry identities, and stable producer error mappings.

### Patch Changes

- Updated dependencies [795eee2]
  - @shipfox/api-logs-dto@26.0.0

## 25.0.0

### Minor Changes

- 00e2ce4: Publish lease_expired, provider_lost, and lifecycle_violation as job execution status reasons; add the optional cause field and RunnerJobLossCauseDto/runnerJobLossCauseSchema to the lease-expired event, with runner_lost fallback when provider state is unavailable.

## 24.2.0

### Minor Changes

- 3cc2ffb: Propagates concurrency supersession through workflow termination events and runner shutdown reconciliation.
- 6100626: Adds stable gate failure reasons and restart diagnostics across workflow APIs, Agent Access, and the client.

## 24.1.0

### Minor Changes

- c730a68: Adds `timed_out` and `run_cancelled` log records, exposes terminal causes on step-attempt termination events, and renders timeout, cancellation, and runner loss distinctly.
- cdc9dfe: Adds the waiting workflow run status to DTO, database, server, and client contracts without producing it during run creation.

### Patch Changes

- Updated dependencies [c730a68]
  - @shipfox/api-logs-dto@24.1.0

## 23.0.0

### Major Changes

- 7fed218: Activates Agent Access OAuth, MCP tools, and settings in the default application composition.

  `API_PUBLIC_URL` is required. Set it to the externally reachable API origin
  before startup. Local development may use `http://localhost:16101`; staging and
  production must use HTTPS.

  The `apiPublicUrl` option of `createAgentAccessRoutes` and
  `createAgentAccessModule` now accepts only a bare HTTPS origin or a loopback
  HTTP origin. Construction rejects paths, queries, fragments, credentials,
  surrounding whitespace, control characters, and non-loopback HTTP origins.

  OAuth consent responses now distinguish CIMD identities from self-registered
  clients. API DTO consumers must use `client_identity_kind`;
  `client_identity_origin` is an origin for CIMD clients and `null` for
  self-registered clients. In `@shipfox/client-agent`, `OAuthConsent` replaces
  `clientIdentityOrigin` with the `clientIdentity` discriminated union; use
  `clientIdentity.kind` and, for CIMD identities, `clientIdentity.origin`.

  Applications that previously appended `createOAuthRoutes`,
  `createOAuthAuthorizationRoutes`, or `createAgentAccessManagementRoutes` to
  `createAuthModule().routes` must remove those manual route groups. The standard
  module composition now registers them, and composing them twice causes duplicate
  Fastify route registration.

  Applications that replace the standard Auth module with `authModuleFactory`
  must register `AUTH_AGENT_ACCESS`. Include the `createAgentAccessAuthMethod`
  export from `@shipfox/api-auth` in the replacement module's auth methods so the
  default MCP route can authenticate agent-access credentials.

  After deployment, fetch
  `$API_PUBLIC_URL/.well-known/oauth-authorization-server` and verify that its
  issuer and endpoint origins match `API_PUBLIC_URL`.

### Minor Changes

- bd5acd2: Bounds listener filter snapshots to referenced context paths and a separate 512 KiB `filter_snapshot` execution payload limit.

### Patch Changes

- @shipfox/api-logs-dto@20.0.0

## 21.2.0

### Minor Changes

- 12cc22e: Adds bounded Agent Access tools for workflow execution trigger-event diagnostics.

### Patch Changes

- 8407bd1: Rejects oversized listener fire deliveries without suppressing matching resolve events.
- 41e1cfc: Surfaces precise, safe trigger event errors in the event detail callout.

## 21.1.0

### Minor Changes

- a0791a3: Adds a `get_step_logs` tool that reads a log tail for one exact workflow step attempt, or the first failed step attempts in a workflow run.
- 661868a: Adds bounded workflow traversal tools to Agent Access.
- 6d94ffc: Preserves structured workflow values in lazy Agent Access diagnostics.

## 21.0.0

### Minor Changes

- f3df1e5: Add bounded Agent Access trigger-event detail and facet discovery tools.

## 20.3.0

### Minor Changes

- 47f6024: Add bounded paged agent-access tools for project, definition, run, annotation, and trigger-event reads.

## 20.2.0

### Minor Changes

- ba481d6: Add the dormant agent-access MCP gateway foundation and shared tool response contracts.
