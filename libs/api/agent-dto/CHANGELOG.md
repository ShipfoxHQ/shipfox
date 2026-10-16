# @shipfox/api-agent-dto

## 34.0.0

### Major Changes

- 1f218c4: Treats every runner as able to renew Git and managed inference credentials. The runner capability manifest no longer has `features`, and `runnerFeaturesSchema` and `RunnerFeaturesDto` are removed. Registration still accepts a `features` key from older runner images and ignores it. `ManagedModelProvider.resolveCredentials` no longer receives `renewableInference`, and `RUNNER_CAPABILITY_REQUIRED_ERROR_CODE` with its `runner-capability-required` error is removed. A composing application must stop using both and always issue renewable credentials. The API no longer writes the "Renewable Git credentials are unavailable on this runner" annotation.

### Minor Changes

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

- 68d6cd6: Adds lab and display label fields to workspace model contracts while preserving strict agent-access projections.
- 8a4f3d8: Adds the GET /__e2e/agent/sessions/:stepAttemptId route and exports the e2eSessionTranscriptResponseSchema/E2eSessionTranscriptResponseDto contract for decrypted agent session transcripts.
- a99c11b: Show managed models that a workspace cannot run. The workspace model catalog marks them `locked`, validation warns with `model-locked` and never rejects, and the model lists mark them with a lock and explain the reason once, with the required action, while keeping them selectable.
- e560f69: The Pi harness now runs on Pi 1.x.

  - **Agent DTO:** `piModelProviderId` maps a Shipfox provider ID to the Pi provider ID. Pi 1.x renamed `azure-openai-responses` to `azure`, and stored provider configs keep the Shipfox ID. `isReservedModelProviderId` now also reserves `azure`, so new custom providers cannot take Pi's built-in ID. The catalog lists Pi's new `meta`, `radius`, and `typesafe` providers as unsupported. Fireworks now defaults to `accounts/fireworks/models/kimi-k3` and Together AI to `deepseek-ai/DeepSeek-V4-Pro-0813`, because Pi removed the previous defaults.
  - **Agent:** Azure OpenAI model lists and credential checks use the renamed Pi provider again.

- a15e118: Lets a managed model provider refuse a model for one workspace at run time. A provider opts in by implementing `availability`, which returns the workspace's locked models. A locked model fails the step with a 422 `agent-model-unavailable` response and a policy notice. An error from `availability` returns a retryable 503. Credential renewal doesn't recheck, so a running step is never cut off. The stored step error carries the notice, and the model unavailable callout shows its message and required action. Providers without `availability` behave as before.
- 3f1363c: Claude now names integration tools `mcp__shipfox__<connection>__<tool>`, which leaves more room under its 64-character tool-name limit.

  - **Agent DTO:** `AGENT_TOOLS_MCP_SERVER_ID` names the server that harnesses see. The persisted descriptor name `shipfox_integration_tools` does not change, so older runners and stored configs keep working.
  - **Logs:** `withoutClaudeIntegrationPrefix` strips the new prefix and the legacy `mcp__shipfox_integration_tools__` prefix, so older transcripts still show their integration tools.

- dd20040: Names the cause of a refused start when an agent step's configuration cannot be used. The agent `agent-config-invalid` error carries a `reason` (`model-unknown`, `provider-unsupported`, `harness-unsupported`, `thinking-unsupported` or `workspace-providers-disabled`) with the `model` and `provider` where they apply. `agent-config-unresolvable` passes them on with the job and step, in the inter-module error, the 422 `details` (`reason`, `model`, `provider`, `job_key`, `step`) and the trigger diagnostic. Every new field is optional, so stored diagnostics still map.
- 70e6983: Adds `managed_provider_id` to the `getWorkspaceModels` inter-module result, so consumers can tell the managed provider's models apart from bring-your-own-key providers.

### Patch Changes

- Updated dependencies [be33fe6]
- Updated dependencies [6b4ae32]
- Updated dependencies [7d20d04]
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
- Updated dependencies [507915a]
- Updated dependencies [9906470]
- Updated dependencies [a429987]
- Updated dependencies [2100749]
- Updated dependencies [f6bc1f4]
- Updated dependencies [651153a]
- Updated dependencies [dbe45d5]
- Updated dependencies [0b661c9]
- Updated dependencies [e71cded]
  - @shipfox/workflow-document@4.0.0
  - @shipfox/policy-notice@0.1.0

## 33.0.0

### Minor Changes

- f24d9cd: Recover completed attempts' session claims before dispatching the next writer, so delayed background releases do not fail sequential agent steps.

## 32.2.0

### Minor Changes

- 3494bf1: Adds a `default` thinking option that requests the provider default without applying workspace or deployment overrides.

### Patch Changes

- Updated dependencies [3494bf1]
  - @shipfox/workflow-document@3.10.0

## 32.1.0

### Minor Changes

- fd261c8: Presents set_output, web search and fetch, and Pi proxied integration calls as readable Activity actions, and exports the shared output tool names.

## 32.0.0

### Major Changes

- e87d5a9: Replaces singular model reference values with measured variants per supported thinking level in workspace model reads.

## 31.0.0

### Minor Changes

- 792fc53: Adds model reference data, pricing, harness settings, and attribution to workspace model reads.
- 3633ccc: Add a shared read of configured workspace models and the workspace default model, returning {models, default_model}.

### Patch Changes

- Updated dependencies [17d86bf]
- Updated dependencies [bcd9232]
- Updated dependencies [bd03ee1]
  - @shipfox/workflow-document@3.9.0

## 29.1.0

### Minor Changes

- d12820f: Publishes complete canonical workflow and step identity through managed inference credentials.

## 29.0.0

### Major Changes

- b891938: Backfills NULL job snapshots to false and denies renewable-inference credential resolution with runner-capability-required when a runner lacks the capability.

### Patch Changes

- Updated dependencies [f571b7f]
  - @shipfox/workflow-document@3.8.0

## 27.0.0

### Major Changes

- 45c9598: Removes `claude.auth_token` from the managed runtime contract and uses the shared API credential for Claude authentication.

## 25.0.0

### Major Changes

- 701df29: Expose missing renewable inference capability as a declared, bounded runtime credential error.

## 24.1.0

### Patch Changes

- Updated dependencies [d559bdb]
  - @shipfox/workflow-document@3.7.0

## 24.0.0

### Patch Changes

- Updated dependencies [33f575e]
  - @shipfox/workflow-document@3.6.0

## 21.1.0

### Minor Changes

- f534da6: Snapshots renewable inference eligibility at job claim and rejects runtime credentials after cancellation or attempt replacement.

## 21.0.0

### Minor Changes

- ff45d70: Adds optional `projectId`, `jobId`, `jobExecutionId`, `stepId`, and `attempt` fields to managed provider credential resolution.
- e225f5e: Adds strict direct integration-tool surfaces and explicit discovery mode to Pi workflow configuration.
- b5d02d1: Adds renewable inference credential metadata, capability, and failure-reason contracts while preserving legacy behavior.

### Patch Changes

- Updated dependencies [e225f5e]
  - @shipfox/workflow-document@3.5.0

## 20.1.0

### Minor Changes

- 3ec04b0: Exposes integration tools with consistent namespaced MCP names across gateway and runner transports.

## 20.0.0

### Patch Changes

- Updated dependencies [46ae6a8]
  - @shipfox/workflow-document@3.4.0

## 19.0.0

### Patch Changes

- c07c8e2: Preserves the pinned agent harness across workflow reruns.
- b416c4c: Preserves existing package behavior while simplifying internal control flow.
- Updated dependencies [b416c4c]
  - @shipfox/workflow-document@3.3.2
  - @shipfox/inter-module@0.2.3

## 18.0.0

### Minor Changes

- a6f242c: Applies each workspace's configured default harness when checking harness-specific tools, thinking, models, and shared sessions. Managed-inference workspaces using Pi can use Pi tool names without declaring the harness.

## 17.1.0

### Minor Changes

- fd6cee5: Allows managed catalog models to declare an optional `claudeModelId` for the Claude harness.
  Runtime resolution keeps the catalog model ID when the field is absent.

## 17.0.0

### Major Changes

- 9f898d9: Replaces the logs-only `LOG_STORAGE_S3_*` base configuration with shared `OBJECT_STORAGE_S3_*` settings, per-consumer prefixes, and optional overrides, and adds encrypted agent-session transcript persistence. Self-hosters must migrate their S3 settings and provide `AGENT_SESSION_ENCRYPTION_KEK`; the DTO packages receive matching major versions for the API package-family release without DTO schema changes.

### Minor Changes

- ed4981e: Adds the lease-authed agent session transcript transport: `GET /runs/jobs/current/steps/:stepId/session` returns the decrypted, still-gzipped head snapshot with manifest headers (or a 204 no-head marker), and `POST .../session?attempt=N&base_segment=S` commits segment `S + 1` under the claim/base CAS with idempotent-retry acks and 409 conflicts. The routes resolve the leased step through a new workflows inter-module method (`getLeasedAgentSessionContext`); the artifact store enforces the session blob cap.

### Patch Changes

- be5fb95: Upgrade Pi to 0.84.2, refresh its supported provider catalog and flagship defaults, expose current direct Anthropic models to the Claude harness, and allow Pi workflow steps to use `thinking: max`.
- Updated dependencies [9fdba44]
- Updated dependencies [be5fb95]
  - @shipfox/workflow-document@3.3.1

## 16.1.0

### Minor Changes

- d1fb0a3: Adds the agent session claim and carry-over inter-module methods (`claimSession`, `carryOverSessions`) with the session descriptor (`id`, `key`, `mode`, `segment`), so workflows can resume or fork a session and rerun attempts can carry sessions forward.

  Session claims are released automatically on step-attempt and job termination, with a stale-claim reap cron as a backstop.

  The previously required `jobLeaseTokenTtlSeconds` option on `createAgentModule` is removed; pass an optional `workflows` client to enable the job-terminated grace sweep.

### Patch Changes

- c1e5dfd: Rejects the per-step `claude` runtime block when attached to reserved model provider ids such as `anthropic`; the block is only accepted alongside a managed (non-reserved) provider id.

## 16.0.0

### Major Changes

- 03e03c7: Defines managed-provider `baseUrl` as a gateway mount root and normalizes it
  for client requests. Providers that previously returned client-ready bases must
  migrate to return the gateway root before upgrading.

### Patch Changes

- Updated dependencies [117edfd]
  - @shipfox/workflow-document@3.3.0

## 15.0.0

### Minor Changes

- 07410fe: Preserves Pi thinking-level mappings and provider compatibility metadata for managed models, so gateway-backed custom providers retain their model-specific reasoning behavior.
- 989eb11: Adds `managed_provider_id` and `instance_default_provider_id` to the model-provider catalog response so clients can detect when an installation provides inference and omit redundant provider setup.

### Patch Changes

- Updated dependencies [0b6addb]
  - @shipfox/workflow-document@3.2.0

## 14.0.0

### Minor Changes

- 09924ca: Adds optional model metadata (`context_window`, `max_output_tokens`, `reasoning`, `input_image`) to managed model entries and passes it through to the pi `custom_provider` contract so managed steps carry the same model descriptor as custom providers.

### Patch Changes

- Updated dependencies [4f30864]
  - @shipfox/workflow-document@3.1.0

## 13.1.0

### Minor Changes

- 0d3c2e3: Updates @shipfox/client-agent, @shipfox/client-onboarding, and @shipfox/client-workflows to show
  managed inference providers without exposing workspace credential setup, keep workflow examples
  limited to supported models, and explain managed-provider failures in workflow runs.
- 5c100d6: Adds support for injecting a managed hosted-inference model provider into agent configuration, with harness-compatible models and instance overrides taking precedence.
- ca91dc3: Adds managed-provider runtime credential resolution and lease-scoped wire fields for pi and Claude harnesses.
- 67aab38: Adds an instance policy that can restrict workspace model-provider configuration to an injected managed provider.

## 12.2.0

### Patch Changes

- Updated dependencies [ce0984d]
  - @shipfox/workflow-document@3.0.1

## 12.0.0

### Minor Changes

- ee2ce67: Accept a `${{ }}` interpolation in an agent step's `thinking` field. The schema
  still offers the per-harness enum for editor completion, and the dispatcher
  checks the resolved value against the harness levels. An unsupported
  resolved level fails the step.
- 28daafe: Validate literal agent model and provider values during workflow authoring.

### Patch Changes

- Updated dependencies [ee2ce67]
- Updated dependencies [e95fdf4]
- Updated dependencies [f78740d]
- Updated dependencies [adf07e7]
- Updated dependencies [3f781ee]
- Updated dependencies [032d316]
- Updated dependencies [c2a8e54]
- Updated dependencies [7f90b0c]
  - @shipfox/workflow-document@3.0.0
  - @shipfox/inter-module@0.2.3

## 10.0.0

### Patch Changes

- 43ce975: Align Pi harness compatibility and provider catalog metadata with the current Pi SDK.
  - @shipfox/inter-module@0.2.2
  - @shipfox/workflow-document@2.1.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/inter-module@0.2.2
  - @shipfox/workflow-document@2.1.3

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [8436596]
- Updated dependencies [475ce59]
  - @shipfox/workflow-document@2.1.2
  - @shipfox/inter-module@0.2.1

## 9.0.0

### Major Changes

- 46aa52f: Closes remaining API package-boundary exceptions and moves model-provider policy behind the Agent implementation boundary.

### Patch Changes

- @shipfox/inter-module@0.2.0
- @shipfox/workflow-document@2.1.1

## 8.0.0

### Minor Changes

- de559bb: Moves Agent validation policy behind a versioned inter-module catalog and injects it into Definitions normalization.

## 6.0.0

### Minor Changes

- 0bb82a4: Adds the Agent and Integrations inter-module APIs, moving Workflows agent configuration, runtime credential resolution, and integration consumers behind producer-owned clients.

### Patch Changes

- Updated dependencies [81f9544]
  - @shipfox/inter-module@0.2.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/workflow-document@2.1.1

## 3.0.0

### Patch Changes

- Updated dependencies [7ce5c9e]
  - @shipfox/workflow-document@2.1.0

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [1b0d344]
  - @shipfox/workflow-document@2.0.1

## 0.1.0

### Minor Changes

- 067a260: Adds workspace model provider settings for configuring, testing, defaulting, and deleting provider credentials.
- de54da2: Adds model provider catalog and provider configuration DTO contracts for backend-managed agent credentials.
- 7ca4c65: Adds step-level agent tool selection to the workflow document contract with shared harness tool deployment helpers.
- 5bcdbf4: Adds harness-native agent tool catalogs with deployment-aware Pi optional tool package config.

### Patch Changes

- aca162b: Add workspace model provider management routes: list provider catalog, list workspace provider configs, test-and-save (upsert) a provider configuration, hard-delete a configuration (clearing the workspace default when needed), and set the workspace default provider. Routes carry per-route error translation and never expose stored credentials.
- 282e66a: Exposes frozen agent integration tool selections as non-secret MCP server descriptors in materialized step config.
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
