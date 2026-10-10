# @shipfox/api-agent-access-dto

## 34.0.0

### Major Changes

- 5588247: Replaces the `models` list in the `get_workflow_authoring_context` result with `model_count`. The `write-a-workflow` skill now finds models through `list_workspace_models` and writes the chosen `provider`.
- 70e6983: Replaces `suggested_models` in the `get_workflow_template` result with bounded `model_recommendations`, so the response fits the size limit for any workspace catalog.

  Placeholders are grouped by the binding their tested model resolves to. Each group has a mode: `recommended` (the tested model and up to four labelled alternatives), `template_default` (the tested model without scores), `workspace_default` (the tested model is unavailable), or `choose`. Every choice carries its complete binding and `provider_required`.

  `@shipfox/workflow-templates` removes `suggestModels` and the manifest `models.<placeholder>.reference` field; the `# model:` line now records the tested setting. The `create-workflow-from-template` skill confirms models per group through a new `choose-models.md` reference.

### Minor Changes

- 16d18f4: Adds the admin MCP endpoint `POST /mcp/admin`, mounted when `AGENT_ACCESS_ADMIN_MCP_ENABLED` is `true` (default `false`). It shares the `/mcp` origin guard, rate limiters, envelope, and OAuth resource, and re-checks the caller's administrator role against the database on every call, returning `admin-role-required` on failure. It serves `find_users`, `start_impersonation`, and `stop_impersonation`, plus any tools passed through the new `additionalAdminTools` option. `AgentAccessContext` gains an optional `admin` marker, and the audit log line carries `adminActorId` and `impersonationWindowId`. The customer `/mcp` endpoint is unchanged.
- c3b44a2: Serves every read-only workspace tool on the admin MCP endpoint `POST /mcp/admin`, with the same name and behavior as on `/mcp` plus a required `workspace_id`. Each call requires the `admin-operator` role and an open impersonation window on that workspace; role failures return `admin-role-required`, and calls without an open window return `impersonation-window-closed`. The tool runs as the administrator in the named workspace and never sees `workspace_id`. Action tools and `get_step_log_download` are not served. Audit records include the administrator and the resolved window; closed-window attempts record the administrator and the target workspace.
- 807ae57: Reads the `{file: ./path}` parts of an agent `prompt` at the same commit as the workflow YAML and inlines their text into the definition. Sync and dev runs from a ref both read the files. A missing, empty, or unreadable file fails with the new `prompt-file-invalid` sync error code and names the step and the file. A prompt file joins the content hash, so a commit that changes only a prompt file produces a new definition. Workflows without prompt files keep their hash.
- c4f486b: Names the cause of a checkout failure. Each refusal now identifies the repository, connection or project it was about, a suspended or removed GitHub App installation has its own `installation-inactive` code, and GitHub's own explanation reaches the step error as `provider_message` and `provider_status`. A missing repository now returns a 422, and a failed token mint is cached for 60 seconds instead of 15 minutes.
- 2e5a311: Dev runs accept action uploads. `POST /dev-runs` and the `create_dev_run` MCP tool take an `actions` field: whole action directories, each replacing the ref's copy of its `uses` path. Both routes accept bodies up to 4 MiB. The `create_dev_run` description tells agents which files to send. The run DTO's `dev_source` gains `local_actions`, the uploaded action paths. It defaults to an empty list for older runs.
- cc644b8: `list_workflow_templates` now marks each role with `from_project`. `get_workflow_template` accepts a project role that matches the project's source provider, and its errors now carry a `message` that names the unknown input, missing role, or invalid provider ID. The tool description and the create-workflow-from-template skill show the expected call shape.
- b9a53b2: Adds `status_reason`, `status_reason_message`, and `outputs` to the run overview attempt. The `shipfox` provider's `get_workflow_run` tool returns them on its attempt, and the agent-access `get_workflow_run` tool returns them on the run.
- dc8065c: Fails a step or job when its `if` can't be evaluated, instead of skipping it. The step error reason is `condition_errored`, and the failure names the cause.
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

- ecc70c2: A step or job `if` condition that cannot be evaluated now records the error in its evaluation trace, with the missing path and the status of the step or job it reads. The run UI says which value is missing and why. A step that has not run exposes empty `outputs`, so `has(steps.x.outputs.y)` returns `false` instead of failing.
- e3b9558: Templates can declare optional roles. A role with `optional: true` gives a `question` and a `tradeoff`. When the role is unbound, `composeTemplate` drops its parts. `composeTemplate` now writes the `# shipfox-template:` header from the bound roles, so base workflows must no longer declare it. `templateRoleBindings` lists every supported binding, with each optional role both bound and unbound.

  `list_workflow_templates` returns `optional`, `question`, and `tradeoff` for each role. It computes `compatible` and `missing_providers` from required roles only. `get_workflow_template` accepts optional roles being left out. The create-workflow-from-template skill asks about an optional role only when the workspace has a connection for it.

- 8136245: Adds the paged and filterable `list_workspace_models` MCP read tool.
- 4aad893: Adds machine placement rules for installation provisioning. A policy can now pass `placement.resolve`, and a job that needs a reserved runner label but only matches refused templates fails within one poll with the new `runner_not_allowed` status reason and its notice. The client shows the notice and its action.
- 76d054a: Adds the `list_registry_packages`, `get_registry_package`, and `diff_registry_action` MCP read tools, so coding agents can browse registry packages and compare two action versions before upgrading.
- 00dd046: Definition sync reads the actions that workflows reference with `uses`, at the same commit as the workflows. It stores their snapshots before it applies the definitions. Sync accepts `uses` only while `DEFINITION_ACTIONS_ENABLED` is on.

  - **Change detection:** a workflow with actions hashes its YAML together with the digests of its actions, so a commit that changes only action code produces a new definition. Workflows without actions keep their YAML-only hash.
  - **Sync error codes:** the sync state error code enums add `action-not-found`, `action-invalid`, `action-too-large`, and `action-unsupported-file`, with a migration for `definitions_sync_error_code`. Manifest diagnostics name the `action.yml` path as their file.
  - **Warnings:** a relative import that does not resolve inside an action gives an `action-import-unresolved` warning on the importing file.

- 15e9d33: `get_workflow_template` accepts `options`, such as `{"pr_mode": "ready"}`, and returns `workflow_yaml` with only the chosen option blocks. The header keeps the legacy form. A call with an unknown option or choice explains the valid ones. The result also carries the manifest's `writes` and `prerequisites` as authored.

  The create-workflow-from-template skill (revision 14) passes the answers as `options` and takes the applicable writes and prerequisites from the result. The template guides no longer repeat their prerequisites and expected writes.

- b121f14: Adds `GET /workspaces/:workspaceId/workflow-templates` for workspace members. It lists workflow templates grouped as `try_now`, `starts_on_event`, or `needs_connection`, ordered by template rank, each with its providers, missing providers, and setup prompt. The response schema is `listWorkspaceWorkflowTemplatesResponseSchema`. The MCP server instructions now tell agents to follow the `create-workflow-from-template` skill when the user asks to create, set up, or suggest a workflow.

### Patch Changes

- 3869c1d: Fail queued job executions that are not claimed before the configured queue timeout and start execution timeouts from the persisted claim timestamp.
- 3e8ff99: Manifest v2 makes slots, secrets, and variables described objects; replaces `start_label` with required `starts`; and adds `keywords`, `flow`, `writes`, `prerequisites`, and `related`. It removes manifest `id`, `revision`, `added_at`, and `rank`; the loader supplies identity and compatibility metadata beside the manifest.
- Updated dependencies [807ae57]
- Updated dependencies [3b3e25c]
- Updated dependencies [fb79732]
- Updated dependencies [f05ecde]
- Updated dependencies [f1f520f]
- Updated dependencies [8872f36]
- Updated dependencies [af3b91f]
- Updated dependencies [d657853]
- Updated dependencies [a509c87]
- Updated dependencies [150d735]
- Updated dependencies [c8857f4]
- Updated dependencies [76fbfe9]
- Updated dependencies [7517867]
- Updated dependencies [3aa5d7a]
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
