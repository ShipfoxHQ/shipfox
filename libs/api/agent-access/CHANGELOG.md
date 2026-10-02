# @shipfox/api-agent-access

## 34.0.0

### Major Changes

- 5588247: Replaces the `models` list in the `get_workflow_authoring_context` result with `model_count`. The `write-a-workflow` skill now finds models through `list_workspace_models` and writes the chosen `provider`.

### Minor Changes

- cc644b8: `list_workflow_templates` now marks each role with `from_project`. `get_workflow_template` accepts a project role that matches the project's source provider, and its errors now carry a `message` that names the unknown input, missing role, or invalid provider ID. The tool description and the create-workflow-from-template skill show the expected call shape.
- b9a53b2: Adds `status_reason`, `status_reason_message`, and `outputs` to the run overview attempt. The `shipfox` provider's `get_workflow_run` tool returns them on its attempt, and the agent-access `get_workflow_run` tool returns them on the run.
- ac3561b: Names what is missing in MCP tool errors when a run cannot start. `fire_manual_trigger` and `create_dev_run` include the variable key and where it is read, the trigger secret key, runner labels and size figures in the error message and details. `start_workflow_run` does the same. The `interpolation-unresolvable` error from Triggers now carries the optional `variableKey`, `jobKey` and `step`.
- e3b9558: Templates can declare optional roles. A role with `optional: true` gives a `question` and a `tradeoff`. When the role is unbound, `composeTemplate` drops its parts. `composeTemplate` now writes the `# shipfox-template:` header from the bound roles, so base workflows must no longer declare it. `templateRoleBindings` lists every supported binding, with each optional role both bound and unbound.

  `list_workflow_templates` returns `optional`, `question`, and `tradeoff` for each role. It computes `compatible` and `missing_providers` from required roles only. `get_workflow_template` accepts optional roles being left out. The create-workflow-from-template skill asks about an optional role only when the workspace has a connection for it.

- 8136245: Adds the paged and filterable `list_workspace_models` MCP read tool.
- 76d054a: Adds the `list_registry_packages`, `get_registry_package`, and `diff_registry_action` MCP read tools, so coding agents can browse registry packages and compare two action versions before upgrading.
- 507915a: A required action can carry an optional `intent`, and `REQUIRED_ACTION_INTENTS` lists the known values. `intent` names a behavior a composing application may provide in place of opening `url`, such as `contact-support`. `url` stays required as the fallback, and an unknown `intent` still parses.

  The admission denial contract, the HTTP 409 `required_action`, and the agent-access error details now keep `intent` when it is set.

- 70e6983: Replaces `suggested_models` in the `get_workflow_template` result with bounded `model_recommendations`, so the response fits the size limit for any workspace catalog.

  Placeholders are grouped by the binding their tested model resolves to. Each group has a mode: `recommended` (the tested model and up to four labelled alternatives), `template_default` (the tested model without scores), `workspace_default` (the tested model is unavailable), or `choose`. Every choice carries its complete binding and `provider_required`.

  `@shipfox/workflow-templates` removes `suggestModels` and the manifest `models.<placeholder>.reference` field; the `# model:` line now records the tested setting. The `create-workflow-from-template` skill confirms models per group through a new `choose-models.md` reference.

- 15e9d33: `get_workflow_template` accepts `options`, such as `{"pr_mode": "ready"}`, and returns `workflow_yaml` with only the chosen option blocks. The header keeps the legacy form. A call with an unknown option or choice explains the valid ones. The result also carries the manifest's `writes` and `prerequisites` as authored.

  The create-workflow-from-template skill (revision 14) passes the answers as `options` and takes the applicable writes and prerequisites from the result. The template guides no longer repeat their prerequisites and expected writes.

- b1cc902: `get_workflow_template` serves templates that have no project source role. It still checks the project, and it skips the source connection lookup.
- b121f14: Adds `GET /workspaces/:workspaceId/workflow-templates` for workspace members. It lists workflow templates grouped as `try_now`, `starts_on_event`, or `needs_connection`, ordered by template rank, each with its providers, missing providers, and setup prompt. The response schema is `listWorkspaceWorkflowTemplatesResponseSchema`. The MCP server instructions now tell agents to follow the `create-workflow-from-template` skill when the user asks to create, set up, or suggest a workflow.

### Patch Changes

- 88b9937: The MCP server instructions tell agents that docs pages describing a task name the skill resource for it.
- 7a63059: Reads `docs://` pages from the docs site's `mcp.mdx/<slug>` route instead of `llms.mdx/<slug>`, and the home page from `mcp.mdx/home`. A docs site set in `DOCS_BASE_URL` must serve `mcp.mdx`.
- 68d6cd6: Adds lab and display label fields to workspace model contracts while preserving strict agent-access projections.
- e1cfc2a: Defaults PR feedback and Linear updates, uses GPT 6 Luna max and GLM 5.3 Flash, and guides trigger-safe issue selection, status retries, and dev-run links.
- 2e5a311: Dev runs accept action uploads. `POST /dev-runs` and the `create_dev_run` MCP tool take an `actions` field: whole action directories, each replacing the ref's copy of its `uses` path. Both routes accept bodies up to 4 MiB. The `create_dev_run` description tells agents which files to send. The run DTO's `dev_source` gains `local_actions`, the uploaded action paths. It defaults to an empty list for older runs.
- 48b8237: Adds GitHub issues as a tracker for the `ticket-to-pr` template. A label or an assignee on an open issue in the project's repository starts the workflow. By default, the workflow adds an in-progress label when work starts and comments on the issue with the PR link. The PR body ends with `Fixes #<number>`, so GitHub links the PR to the issue.

  `get_workflow_template` now suggests the project's source integration connection for a role on the source provider, such as GitHub issues as the tracker.

- fdca5b6: Guided template setup asks fewer, plainer questions. The agent chooses install, build, and test commands from the repository instead of asking the user to confirm them, and asks only when several CI workflows could be watched. Option markers can list several choices, such as `# option:report_outcomes=needs_person,both begin`.

  The agent binds the template's tested model or the workspace default without asking and tells the user they can change it later in the workflow file. The `get_workflow_template` tool description also tells the agent to offer alternatives only when the user asks.

- Updated dependencies [e99aa97]
- Updated dependencies [6b4ae32]
- Updated dependencies [b97171d]
- Updated dependencies [5f88947]
- Updated dependencies [5a14986]
- Updated dependencies [9806da2]
- Updated dependencies [5588247]
- Updated dependencies [8a926dc]
- Updated dependencies [ba1aff7]
- Updated dependencies [ba0d750]
- Updated dependencies [68d6cd6]
- Updated dependencies [e1cfc2a]
- Updated dependencies [e64c10d]
- Updated dependencies [175482e]
- Updated dependencies [3b3e25c]
- Updated dependencies [fb79732]
- Updated dependencies [2e5a311]
- Updated dependencies [f05ecde]
- Updated dependencies [4273dad]
- Updated dependencies [8a4f3d8]
- Updated dependencies [cc644b8]
- Updated dependencies [b9a53b2]
- Updated dependencies [a9e85c1]
- Updated dependencies [c06262b]
- Updated dependencies [eab1dd7]
- Updated dependencies [8b16e92]
- Updated dependencies [184305a]
- Updated dependencies [cfd75e4]
- Updated dependencies [a73e712]
- Updated dependencies [48b8237]
- Updated dependencies [fdca5b6]
- Updated dependencies [8872f36]
- Updated dependencies [a99c11b]
- Updated dependencies [fc455ac]
- Updated dependencies [6b01f3d]
- Updated dependencies [ac3561b]
- Updated dependencies [af3b91f]
- Updated dependencies [f5bdc5b]
- Updated dependencies [e3b9558]
- Updated dependencies [8136245]
- Updated dependencies [9674325]
- Updated dependencies [5ce9d5b]
- Updated dependencies [3869c1d]
- Updated dependencies [55152c5]
- Updated dependencies [c06262b]
- Updated dependencies [a15e118]
- Updated dependencies [4aad893]
- Updated dependencies [c6f2ae3]
- Updated dependencies [fafbe84]
- Updated dependencies [737c625]
- Updated dependencies [d77a8c4]
- Updated dependencies [cb411b1]
- Updated dependencies [f64bff1]
- Updated dependencies [0975515]
- Updated dependencies [a509c87]
- Updated dependencies [150d735]
- Updated dependencies [c8857f4]
- Updated dependencies [76fbfe9]
- Updated dependencies [7517867]
- Updated dependencies [76d054a]
- Updated dependencies [5fb1fbd]
- Updated dependencies [b1cc902]
- Updated dependencies [507915a]
- Updated dependencies [3aa5d7a]
- Updated dependencies [9674325]
- Updated dependencies [15282f5]
- Updated dependencies [71c11b1]
- Updated dependencies [3c92a34]
- Updated dependencies [257e53e]
- Updated dependencies [e701cfc]
- Updated dependencies [94e77bc]
- Updated dependencies [dbe45d5]
- Updated dependencies [e2e561c]
- Updated dependencies [dd20040]
- Updated dependencies [daf0208]
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
- Updated dependencies [8f54fc9]
- Updated dependencies [a4c05ba]
- Updated dependencies [c14f398]
- Updated dependencies [82f2480]
- Updated dependencies [ffffc16]
- Updated dependencies [e71cded]
- Updated dependencies [6b2a308]
- Updated dependencies [70e6983]
- Updated dependencies [b121f14]
  - @shipfox/api-secrets-dto@34.0.0
  - @shipfox/workflow-document@3.11.0
  - @shipfox/workflow-templates@2.0.0
  - @shipfox/api-agent-access-dto@34.0.0
  - @shipfox/api-auth-dto@34.0.0
  - @shipfox/api-workflows-dto@34.0.0
  - @shipfox/api-agent-dto@34.0.0
  - @shipfox/api-definitions-dto@34.0.0
  - @shipfox/api-triggers-dto@34.0.0
  - @shipfox/api-integration-core-dto@34.0.0
  - @shipfox/node-fastify@0.5.0
  - @shipfox/node-opentelemetry@0.7.0
  - @shipfox/api-registry-dto@34.0.0
  - @shipfox/registry-format@0.1.0
  - @shipfox/api-logs-dto@34.0.0
  - @shipfox/api-auth-context@34.0.0
  - @shipfox/node-drizzle@0.3.7
  - @shipfox/node-module@1.1.3

## 33.2.1

### Patch Changes

- Updated dependencies [1a724f0]
- Updated dependencies [5ef5488]
- Updated dependencies [5082d8a]
  - @shipfox/workflow-templates@1.3.0

## 33.2.0

### Patch Changes

- Updated dependencies [310bf1d]
- Updated dependencies [94a6e9d]
- Updated dependencies [7062352]
- Updated dependencies [6759ba2]
- Updated dependencies [e4f160d]
  - @shipfox/workflow-templates@1.2.0

## 33.1.0

### Minor Changes

- 62e1ef4: Serves Shipfox documentation as cached MCP resources and adds the `search_docs` tool.

### Patch Changes

- 238df72: Adds separate skills for validating and testing local workflow changes, and shortens the development run tool description.
- Updated dependencies [238df72]
- Updated dependencies [62e1ef4]
- Updated dependencies [81c982a]
- Updated dependencies [1092419]
- Updated dependencies [3bc43e5]
- Updated dependencies [0bd5f3d]
  - @shipfox/workflow-templates@1.1.0
  - @shipfox/api-agent-access-dto@33.1.0

## 33.0.0

### Minor Changes

- f03324a: Replaces model profiles and `resolved_models` with `suggested_models` in template results. It lists available model and thinking choices and ranks qualified measured combinations by cost.
- fe68025: Serve embedded workflow skills as MCP resources with an index, manifest, and audited reads.

  Remove `get_workflow_setup_guide` from the public MCP contract. The entry point is inactive, and no consumer outside this repository uses the tool.

  Point the first workflow prompt at the template skill.

- ed5fe9f: Adds bounded wait support to `get_workflow_run` so callers can follow terminal or listening runs without polling.

### Patch Changes

- Updated dependencies [f03324a]
- Updated dependencies [f24d9cd]
- Updated dependencies [fe68025]
- Updated dependencies [ed5fe9f]
  - @shipfox/workflow-templates@1.0.0
  - @shipfox/api-agent-access-dto@33.0.0
  - @shipfox/api-agent-dto@33.0.0
  - @shipfox/api-workflows-dto@33.0.0
  - @shipfox/api-triggers-dto@33.0.0

## 32.2.0

### Patch Changes

- Updated dependencies [d593e1b]
- Updated dependencies [3494bf1]
  - @shipfox/workflow-templates@0.5.0
  - @shipfox/api-agent-dto@32.2.0
  - @shipfox/api-agent-access-dto@32.2.0
  - @shipfox/api-definitions-dto@32.2.0
  - @shipfox/api-workflows-dto@32.2.0
  - @shipfox/api-triggers-dto@32.2.0

## 32.1.0

### Patch Changes

- Updated dependencies [e13617c]
- Updated dependencies [751ae3a]
- Updated dependencies [fd261c8]
  - @shipfox/workflow-templates@0.4.0
  - @shipfox/api-agent-dto@32.1.0
  - @shipfox/api-workflows-dto@32.1.0
  - @shipfox/api-triggers-dto@32.1.0

## 32.0.0

### Major Changes

- e87d5a9: Replaces singular model reference values with measured variants per supported thinking level in workspace model reads.

### Minor Changes

- 68f10d5: Adds a versioned first-party workflow setup guide and its read-only MCP tool.

### Patch Changes

- Updated dependencies [e87d5a9]
- Updated dependencies [212c6b6]
- Updated dependencies [68f10d5]
  - @shipfox/api-agent-dto@32.0.0
  - @shipfox/api-agent-access-dto@32.0.0
  - @shipfox/api-workflows-dto@32.0.0
  - @shipfox/workflow-templates@0.3.0
  - @shipfox/api-triggers-dto@32.0.0

## 31.0.0

### Minor Changes

- 2954fac: Adds workspace-bound tools for discovering and composing first-party workflow templates.
- 792fc53: Adds model reference data, pricing, harness settings, and attribution to workspace model reads.
- 0f2bf90: Adds model profiles and workspace-resolved model selections to workflow template results.
- 3633ccc: Add a shared read of configured workspace models and the workspace default model, returning {models, default_model}.
- 0ab7a16: Returns user-facing run permalinks from the MCP run tools when the client URL is configured.
- 85f3d47: Adds shape-only event-trigger checks and reports whether a replay event was checked.
- 14f786a: Add the `get_workflow_authoring_context` tool for reading workspace workflow-authoring facts.

### Patch Changes

- Updated dependencies [da1114b]
- Updated dependencies [2954fac]
- Updated dependencies [9b671f9]
- Updated dependencies [bcd9232]
- Updated dependencies [792fc53]
- Updated dependencies [0f2bf90]
- Updated dependencies [3633ccc]
- Updated dependencies [d3eb572]
- Updated dependencies [0ab7a16]
- Updated dependencies [bab2786]
- Updated dependencies [c5c7fa3]
- Updated dependencies [9e170c7]
- Updated dependencies [bcd9232]
- Updated dependencies [85f3d47]
- Updated dependencies [14f786a]
  - @shipfox/api-integration-core-dto@31.0.0
  - @shipfox/api-agent-access-dto@31.0.0
  - @shipfox/api-triggers-dto@31.0.0
  - @shipfox/api-agent-dto@31.0.0
  - @shipfox/workflow-templates@0.2.0
  - @shipfox/api-workflows-dto@31.0.0
  - @shipfox/api-secrets-dto@31.0.0
  - @shipfox/api-definitions-dto@31.0.0

## 30.0.0

### Patch Changes

- Updated dependencies [f05d344]
- Updated dependencies [b734fcf]
  - @shipfox/api-integration-core-dto@30.0.0
  - @shipfox/api-workflows-dto@30.0.0
  - @shipfox/api-triggers-dto@30.0.0
  - @shipfox/api-definitions-dto@30.0.0

## 29.1.0

### Patch Changes

- Updated dependencies [cbc2ee8]
  - @shipfox/api-auth-dto@29.1.0
  - @shipfox/api-auth-context@29.1.0
  - @shipfox/api-workflows-dto@29.1.0
  - @shipfox/api-triggers-dto@29.1.0

## 29.0.0

### Minor Changes

- 86ad2b7: Adds dry-run validation to the `create_dev_run` agent tool so workflows can be checked against a past event before starting a run.

### Patch Changes

- f4f1f10: Preserves full PostgreSQL timestamp precision in cursor pagination, so records are no longer skipped when their timestamps differ only at sub-millisecond precision.
- Updated dependencies [86ad2b7]
- Updated dependencies [a34066f]
- Updated dependencies [e7a8fe4]
- Updated dependencies [f4f1f10]
- Updated dependencies [8e74f71]
  - @shipfox/api-agent-access-dto@29.0.0
  - @shipfox/node-fastify@0.4.7
  - @shipfox/api-workflows-dto@29.0.0
  - @shipfox/node-drizzle@0.3.6
  - @shipfox/api-logs-dto@29.0.0
  - @shipfox/annotations-dto@29.0.0
  - @shipfox/api-auth-context@29.0.0
  - @shipfox/node-module@1.1.2
  - @shipfox/api-triggers-dto@29.0.0
  - @shipfox/api-definitions-dto@29.0.0

## 28.0.0

### Minor Changes

- f081104: Adds local workflow content, actionable refusal details, and provenance warnings to the `create_dev_run` agent tool.

### Patch Changes

- c2f1aab: Allows workflow runs to fire manual triggers with parent-run causation and workflow trigger history.
- Updated dependencies [16b21f3]
- Updated dependencies [6338cc4]
- Updated dependencies [f081104]
- Updated dependencies [e8f0212]
- Updated dependencies [d62e17e]
- Updated dependencies [7067bc3]
- Updated dependencies [c2f1aab]
  - @shipfox/api-triggers-dto@28.0.0
  - @shipfox/api-agent-access-dto@28.0.0
  - @shipfox/api-workflows-dto@28.0.0

## 27.2.0

### Minor Changes

- bc7f35c: Forwards workflow validation errors and trigger-filter explanations through agent-access errors.
- dd4c495: Allows composition roots to append custom Agent Access tools while retaining the standard tool behavior.

### Patch Changes

- Updated dependencies [0827733]
- Updated dependencies [ef44a76]
- Updated dependencies [6ad8c2e]
- Updated dependencies [45cf692]
- Updated dependencies [f5bc959]
  - @shipfox/api-integration-core-dto@27.2.0
  - @shipfox/api-definitions-dto@27.2.0
  - @shipfox/api-workflows-dto@27.2.0
  - @shipfox/api-triggers-dto@27.2.0

## 27.1.0

### Patch Changes

- Updated dependencies [e0b7bd1]
  - @shipfox/api-workflows-dto@27.1.0
  - @shipfox/api-triggers-dto@27.1.0

## 27.0.0

### Patch Changes

- b9e9794: Activates agent-access action tools after operators revoke pre-activation grants.
  - @shipfox/api-workflows-dto@27.0.0
  - @shipfox/api-triggers-dto@27.0.0

## 26.1.0

### Patch Changes

- Updated dependencies [db12613]
- Updated dependencies [cb99d51]
- Updated dependencies [c2c97ac]
  - @shipfox/api-definitions-dto@26.1.0
  - @shipfox/api-agent-access-dto@26.1.0
  - @shipfox/api-workflows-dto@26.1.0
  - @shipfox/api-logs-dto@26.1.0
  - @shipfox/node-error-monitoring@0.4.0
  - @shipfox/api-triggers-dto@26.1.0
  - @shipfox/node-fastify@0.4.6
  - @shipfox/node-module@1.1.1
  - @shipfox/api-auth-context@26.1.0

## 26.0.0

### Minor Changes

- a8ff016: Adds bounded error details, exposes state-changing action tools in tools/list with their destructiveHint, idempotentHint, and openWorldHint annotations, and limits action calls to 10 per credential per minute on top of the existing shared window.
- 86ba951: Adds MCP tools for discovering integration connections and their bounded tool and event catalogs, and exposes each project's resolved source connection in list_projects results.
- b22c120: Adds the `get_step_log_download` MCP tool for stream-bound step-log downloads.
- e78d21a: Adds dormant agent-access action tools with bounded inputs, retry identities, and stable producer error mappings.

### Patch Changes

- fb73bca: Removes unused OAuth scope fields and carries agent access through workspace membership authority.
- Updated dependencies [a8ff016]
- Updated dependencies [6eaacf0]
- Updated dependencies [795eee2]
- Updated dependencies [da717b1]
- Updated dependencies [db054aa]
- Updated dependencies [86ba951]
- Updated dependencies [e157b10]
- Updated dependencies [4a75c26]
- Updated dependencies [b22c120]
- Updated dependencies [7acec37]
- Updated dependencies [5cb4279]
- Updated dependencies [fb73bca]
- Updated dependencies [8229356]
- Updated dependencies [e78d21a]
- Updated dependencies [aafce80]
  - @shipfox/api-agent-access-dto@26.0.0
  - @shipfox/api-integration-core-dto@26.0.0
  - @shipfox/api-logs-dto@26.0.0
  - @shipfox/api-workflows-dto@26.0.0
  - @shipfox/api-triggers-dto@26.0.0
  - @shipfox/api-auth-dto@26.0.0
  - @shipfox/api-auth-context@26.0.0
  - @shipfox/node-module@1.1.0

## 25.0.0

### Patch Changes

- Updated dependencies [00e2ce4]
- Updated dependencies [bba82ae]
- Updated dependencies [9e8b007]
  - @shipfox/api-workflows-dto@25.0.0
  - @shipfox/api-agent-access-dto@25.0.0
  - @shipfox/api-auth-context@25.0.0

## 24.2.0

### Minor Changes

- 6100626: Adds stable gate failure reasons and restart diagnostics across workflow APIs, Agent Access, and the client.

### Patch Changes

- Updated dependencies [011d9ec]
- Updated dependencies [3cc2ffb]
- Updated dependencies [6100626]
  - @shipfox/api-workflows-dto@24.2.0
  - @shipfox/api-agent-access-dto@24.2.0
  - @shipfox/api-definitions-dto@24.2.0

## 24.1.1

### Patch Changes

- @shipfox/api-definitions-dto@24.1.1
- @shipfox/api-workflows-dto@24.1.1

## 24.1.0

### Minor Changes

- cdc9dfe: Adds the waiting workflow run status to DTO, database, server, and client contracts without producing it during run creation.

### Patch Changes

- Updated dependencies [d559bdb]
- Updated dependencies [c730a68]
- Updated dependencies [34b5267]
- Updated dependencies [cdc9dfe]
  - @shipfox/api-definitions-dto@24.1.0
  - @shipfox/api-agent-access-dto@24.1.0
  - @shipfox/api-logs-dto@24.1.0
  - @shipfox/api-workflows-dto@24.1.0
  - @shipfox/api-auth-context@24.1.0
  - @shipfox/node-error-monitoring@0.3.1
  - @shipfox/node-fastify@0.4.5
  - @shipfox/node-opentelemetry@0.6.6
  - @shipfox/node-module@1.0.11

## 24.0.0

### Patch Changes

- @shipfox/api-definitions-dto@24.0.0
- @shipfox/api-auth-context@24.0.0
- @shipfox/api-workflows-dto@24.0.0

## 23.2.0

### Patch Changes

- @shipfox/api-projects-dto@23.2.0
- @shipfox/api-auth-context@23.2.0

## 23.1.0

### Patch Changes

- @shipfox/api-auth-context@23.1.0

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

### Patch Changes

- Updated dependencies [7fed218]
- Updated dependencies [bd5acd2]
  - @shipfox/api-agent-access-dto@23.0.0
  - @shipfox/api-auth-context@23.0.0
  - @shipfox/api-workflows-dto@23.0.0
  - @shipfox/api-definitions-dto@23.0.0
  - @shipfox/annotations-dto@20.3.0
  - @shipfox/api-logs-dto@20.0.0
  - @shipfox/api-projects-dto@21.0.0
  - @shipfox/api-triggers-dto@22.0.0
  - @shipfox/inter-module@0.2.3
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-fastify@0.4.4
  - @shipfox/node-module@1.0.10
  - @shipfox/node-opentelemetry@0.6.5

## 22.0.0

### Patch Changes

- 6fd8c7b: Omit absent cursors, attempts, filters, and execution IDs from agent tool requests.
- Updated dependencies [c392dfb]
- Updated dependencies [e390533]
  - @shipfox/api-triggers-dto@22.0.0
  - @shipfox/api-workflows-dto@22.0.0

## 21.2.0

### Minor Changes

- 12cc22e: Adds bounded Agent Access tools for workflow execution trigger-event diagnostics.

### Patch Changes

- Updated dependencies [0745878]
- Updated dependencies [1f2c634]
- Updated dependencies [12cc22e]
- Updated dependencies [8407bd1]
- Updated dependencies [41e1cfc]
  - @shipfox/node-module@1.0.10
  - @shipfox/api-workflows-dto@21.2.0
  - @shipfox/api-agent-access-dto@21.2.0
  - @shipfox/api-triggers-dto@21.2.0
  - @shipfox/api-definitions-dto@21.2.0

## 21.1.0

### Minor Changes

- a0791a3: Adds a `get_step_logs` tool that reads a log tail for one exact workflow step attempt, or the first failed step attempts in a workflow run.
- 661868a: Adds bounded workflow traversal tools to Agent Access.
- 6d94ffc: Preserves structured workflow values in lazy Agent Access diagnostics.

### Patch Changes

- Updated dependencies [a0791a3]
- Updated dependencies [661868a]
- Updated dependencies [01af160]
- Updated dependencies [8a98a87]
- Updated dependencies [6d94ffc]
- Updated dependencies [6fac62f]
  - @shipfox/api-agent-access-dto@21.1.0
  - @shipfox/api-workflows-dto@21.1.0

## 21.0.0

### Minor Changes

- f3df1e5: Add bounded Agent Access trigger-event detail and facet discovery tools.

### Patch Changes

- Updated dependencies [12f7b10]
- Updated dependencies [e225f5e]
- Updated dependencies [879f227]
- Updated dependencies [cffa62d]
- Updated dependencies [5886bf2]
- Updated dependencies [b5d02d1]
- Updated dependencies [32e9fa0]
- Updated dependencies [f3df1e5]
  - @shipfox/api-workflows-dto@21.0.0
  - @shipfox/api-definitions-dto@21.0.0
  - @shipfox/api-projects-dto@21.0.0
  - @shipfox/api-agent-access-dto@21.0.0
  - @shipfox/api-triggers-dto@21.0.0

## 20.4.0

### Minor Changes

- 0b32d1a: Remove personal access token support from agent access.

### Patch Changes

- Updated dependencies [9a66057]
- Updated dependencies [0b32d1a]
  - @shipfox/api-workflows-dto@20.4.0
  - @shipfox/api-auth-context@20.4.0

## 20.3.0

### Minor Changes

- 47f6024: Add bounded paged agent-access tools for project, definition, run, annotation, and trigger-event reads.

### Patch Changes

- Updated dependencies [813a284]
- Updated dependencies [47f6024]
- Updated dependencies [da6fbb8]
  - @shipfox/api-workflows-dto@20.3.0
  - @shipfox/api-agent-access-dto@20.3.0
  - @shipfox/annotations-dto@20.3.0
  - @shipfox/api-definitions-dto@20.3.0

## 20.2.0

### Minor Changes

- ba481d6: Add the dormant agent-access MCP gateway foundation and shared tool response contracts.

### Patch Changes

- Updated dependencies [ba481d6]
  - @shipfox/api-agent-access-dto@20.2.0
  - @shipfox/node-fastify@0.4.4
  - @shipfox/api-auth-context@20.2.0
  - @shipfox/node-module@1.0.9
