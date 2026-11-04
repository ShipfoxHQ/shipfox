# @shipfox/api-integration-core-dto

## 34.0.0

### Major Changes

- 900a25a: The calling project's access now decides every repository and connection check on checkout and on integration tools.

  - **Checkout:** a job that checks out a repository outside its project's access fails, and a by-name checkout is pinned to the id of the repository it matches in the project's access. A running job loses access at its next credential renewal after the repository is removed.
  - **Tools:** a tool call on a connection or repository outside the project's access is denied with `connection-not-allowed` or `repository-not-granted`. A call with no project is refused. An agent step, tool step, or action that names a connection outside access fails at materialization with `connection-not-allowed`.
  - **Validation:** a workflow that names a connection outside the project's access gets a warning.
  - **Contract:** `createCheckoutSpec` and `createCheckoutCredentials` require the calling `projectId`. `getAgentToolsContext` takes `projectId` and marks each connection `allowed`. Checkout renewal subjects store their `project_id`.
  - **Removed:** the 30-second shared authorization cache, the `RepositoryAuthorizationMode` type export, and the `invalidateRepositoryAuthorizationCache` option on the provider load options and the GitHub provider options. A change to access applies on the next call.

- e6981d5: An integration connection no longer has a repository access mode. Every connection reaches all repositories its installation can see, and projects narrow access instead.

  - **Release note:** a connection that was set to **Only your projects' repositories** now reaches every repository its installation sees. A project with full access can use all of them. This migration sets every connection to the open behavior and removes the setting. To narrow a project, limit its access.
  - **Integration SPI:** `IntegrationConnection` no longer has `repositoryAccessMode`, and `IntegrationConnectionRepositoryAccessMode` is gone.
  - **Integration core DTOs:** the `CONNECTION_REPOSITORY_ACCESS_CHANGED` event and the repository access schemas are gone.
  - **Projects DTOs:** the inter-module method `listProjectsBySourceConnection` is gone.
  - **API:** `GET` and `PUT /integration-connections/:connectionId/repository-access` are removed. The `repository_access` column is dropped from connections and secret cleanups.
  - **Integration core:** `IntegrationConnectionRepositoryAccessMode` is no longer exported from the package root.
  - **Client:** the connection page no longer has a repository access section, and the connection menu no longer offers **Manage repository access**. Use **Open in GitHub** to change the repositories on GitHub. `RepositoryAccess`, `RepositoryAccessMode`, `RepositoryAccessRepository`, `listIntegrationConnectionRepositoryAccess`, `updateIntegrationConnectionRepositoryAccess`, and the matching query hooks are no longer exported.

### Minor Changes

- 2062ec8: An agent in a Slack or Linear conversation starts workflow runs. `fireManualTrigger` accepts a conversation with a provider and no user as an agent actor, and `start_workflow_run` no longer needs a Shipfox user for such a conversation. The run budget still applies. The run page reads "Started by Shippy in Slack", and Linear shows the run link on the agent session. Web conversations still record their author.
- 1fa56a2: The new `resolveAgentToolsBatch` operation resolves the tool selections of several callers in one call. It loads the provider catalogs and workspace connections once and answers each request on its own, so a refused selection fails only its request. Run creation uses it in place of one `resolveAgentTools` call per agent step and action step.
- c4f486b: Names the cause of a checkout failure. Each refusal now identifies the repository, connection or project it was about, a suspended or removed GitHub App installation has its own `installation-inactive` code, and GitHub's own explanation reaches the step error as `provider_message` and `provider_status`. A missing repository now returns a 422, and a failed token mint is cached for 60 seconds instead of 15 minutes.
- 2cc76a9: Read a project's config from whichever repository is active.

  - **Integrations contract:** `getConfigSource`, `listConfigFiles`, `readConfigFile`, and `listConfigCommits`. A project in another workspace answers `project-not-found`, and a provider without `listCommits` answers `history-unsupported`.
  - **HTTP:** `GET /projects/:projectId/config`, `/config/files`, `/config/files/*`, and `/config/commits`. Reads stay under `.shipfox/`, and the source comes from the project row, so it answers during a provider outage.
  - **GitHub:** `listCommits` on the source-control provider and `listCommits` on `GithubApiClient`, which lists the commits that changed a path and pages with GitHub's next link.

- 2339c1b: A conversation can start workflow runs, with a limit on how many it starts without a person writing.

  - **Start tool:** `start_workflow_run` is now offered to conversations. It starts a root run in the conversation's project for the conversation owner, and its idempotency key is `conversation:<conversationId>:<callItemId>`, so a repeated call returns the same run. The conversation caller context now carries `agentKey`.
  - **Run budget:** `claimConversationRunStart` on the agent inter-module contract spends one of five run starts. A message from a person resets the count. At the limit, the tool returns `run-budget-exhausted` and tells the agent to ask the user. A repeated call doesn't spend the budget again.
  - **Manual trigger:** `fireManualTrigger` and the manual trigger payload take an optional `conversation` with `id`, `agentKey`, and `provider`. The workflows inter-module contract gains `hasRunForIdempotencyKey`.
  - **Run reads:** run list items and the run overview header return `conversation` with `agent_key`, `provider`, and `author_user_id`, and never the conversation id.
  - **Client:** the run list shows `via Shippy`, the run summary shows `Started by <author> via Shippy`, and the chat shows a `Run started` row that never joins a group of reads. The panel copy and suggested prompts say that Shippy can start work.
  - **Shippy prompt:** a conversation pinned before this change says it can't start runs and suggests a new conversation.

- 7cc3735: Adds a `conversation` caller to `integrations.callTool`, so a server-side agent turn can call tools with no job lease.

  - **Breaking:** `AgentToolsCallerContext` and `IntegrationToolCallCaller` become unions. Code that reads `runId`, `jobExecutionId`, or `stepId` from a caller must narrow on the caller kind first.
  - **Provider contract:** `AgentToolsProvider` gains an optional `conversationCatalog`. A provider without one offers a conversation nothing.
  - **Inter-module contract:** `listConversationTools` returns the tools to offer, and `callTool` refuses any other tool for a conversation caller.
  - **Project scoping:** on the `shipfox` provider, a conversation caller can't pass `project_id`, can't call `list_projects`, gets `not-found` for a run or step in another project, and sees a null `parent_run` when the parent is in another project. Lease callers are unchanged.
  - **Audit:** tool call records name the conversation caller with its project, conversation, turn, and call item. The `integrations_agent_tool_call` metric adds a `conversation` value to its `caller` label only.

- b59424d: A managed project whose access lists one source-control connection, limited to exactly one repository, checks it out by default, at the revision of the repository itself.

  - **Default checkout:** a job that sets no `checkout` on such a project checks out that repository. A repository written without a connection uses the one source-control connection the project lists, and the workspace's only one when the project has access to all connections. Run admission checks the default checkout's connection.
  - **Revision:** a checkout uses the commit of the triggering event when the event came from the checked-out repository, matched by connection and repository, whether or not a project uses that repository as its config source. This also fixes `repository:` checkouts of a repository that isn't a config source, for every project. A change to the managed config checks out the repository's default branch.
  - **Contract:** `listSourceControlConnectionIds` lists a workspace's active source-control connections. Run trigger references carry optional `connectionId` and `externalRepositoryId`, and runs created before this release keep the comparison by project. `@shipfox/api-projects-dto` exports `defaultConnectionId`.

- 4273dad: Adds the Discord interaction webhook route to the shared stored-request contract.
- 9e173c3: Adds `provider_access` to a connection that lost access at the provider, either `removed` or `suspended`. Enabling such a connection now returns 409 `connection-provider-access-unavailable`, and a checkout on it tells the runner to unsuspend or reinstall the GitHub App. GitHub reports the access from the installation and no longer returns an external URL after an uninstall.
- b92d2a8: An agent file can grant integration tools with `integrations:`, using the selectors and `allow_write` rule of an agent step.

  - **Sync:** definition sync checks the selectors, connections, and `allow_write` of each agent file. An invalid file keeps its last valid version.
  - **Conversations:** the tools of a granted connection appear beside the built-in tools, named by connection. Tools that return files or images are left out. A tool removed from the file stops being callable.
  - **Write tools:** a write call is recorded before it runs. A retry that finds it started does not run it again. It stores a result with the outcome `unknown`, and the model reads the state before it tries again.
  - **Integrations:** the new `resolveAgentTools` operation expands selectors into tool grants. `getAgentToolsContext` no longer needs a default connection.

- 3022de6: An `unknown` tool call error now says when the provider may have received the call. A write in a conversation with that error stores the outcome `unknown`, and an `unknown` error from a call the provider rejected, or one that failed before the provider was reached, stays an error.
- f769d90: Add the `image` tool result kind. A provider marks a tool that returns images with `result: 'image'`. An agent step can call it and receives the image blocks. A tool step that names it fails validation with `integration-tool-agent-only`, and an action cannot call it: the generated action tool types leave it out and the action endpoint refuses the call.
- 15b4274: Adds the `interaction` capability to the integration SPI, so people can talk to agents through a provider. A provider declares `interactionEvents`, reads events into interactions, sends replies, and can report progress. Integrations exposes `readInteraction`, `sendInteractionReply`, `reportInteractionProgress`, and `listInteractionProviders` as inter-module operations. `@shipfox/api-integration-spi/testing` exports `createFakeInteractionProvider`.
- a64d96d: Agents can write config to a managed project, on branches only. Agent access gains `list_config_files`, `read_config_file`, and `commit_config_changes`; the reads also work on linked projects, and the write answers `repository-read-only` with the repository name for a linked one. The commit creates its branch on first use, refuses the default branch, enforces the path and size rules, and gives one `stale-head` to two racing commits. The create-workflow-from-template skill (revision 15) writes a Shipfox-hosted project's workflow to a branch, tests it, and stops without suggesting a pull request.
- 1872f3d: Move a managed project to a repository.

  - **Routes:** `POST /projects/:projectId/config/link` checks the target and refuses with `config-exists`, `repository-in-use`, `repository-empty`, `connection-inactive`, or `link-unsupported`. With `dry_run: true` it stops there. Otherwise it makes the managed repository read-only, opens a pull request that adds `.shipfox/`, moves the project's config source, and finishes. A stopped move answers `503 move-unconfirmed`, and the next call resumes the stored attempt without opening a second pull request. `POST /projects/:projectId/config/link/pull-request` opens a new one after a closed pull request. Impersonated sessions are refused on both.
  - **Config read:** `GET /projects/:projectId/config` and `getConfigSource` return the move and the pull request state. A merged pull request clears its stored URL.
  - **Providers:** the source-control SPI gains `openConfigPullRequest` and `getConfigPullRequest`, idempotent on the branch. GitHub implements both.
  - **Projects:** the inter-module contract gains `moveProjectSource`, which moves a project's config source to the linked repository.
  - **E2E setup:** `mergeTestVcsPullRequest` and `closeTestVcsPullRequest` drive a Test VCS pull request.

- 0af8bad: Adds projects with a managed repository, behind the `managed-config-repos` workspace flag. `POST /projects` accepts a managed source, the project DTO gains `source.kind`, and the workspace's hidden connection stays out of every list. A job with a default checkout on a managed project now explains how to fix it.
- a020cbf: Lets a managed project reach every repository the GitHub App can see. New connections start with access to all repositories, and existing connections keep their mode. A managed project has no default checkout, so a job checks out only what it names. A `checkout:` with a `repository` and tools with no `connection` use the workspace's only source-control connection, and ask for a `connection` when there is none or several.
- cdb88a7: A project can store and read its access: the connections it can use and, for each, the repositories it can reach. Nothing enforces it yet.

  - **Projects:** `GET` and `PUT /projects/:projectId/access`, with admin-only writes. A linked project's config connection can be saved with zero repositories, which means only the config repository. A repository rename updates the stored names of a listed repository.
  - **Projects DTO:** a browser-safe access evaluator and the policy types, and `getProjectAccessPolicy` and `getProjectAccessPolicies` on the inter-module contract.
  - **Integrations:** providers can declare `resourceKinds` and implement `listScopeResources` and `resolveScopeResource`. GitHub and Gitea do so for repositories. `GET /integration-connections/:connectionId/scope-resources` serves the picker, and `getScopeConnection` and `resolveScopeResource` join the inter-module contract.
  - **Connection deletion** of every kind writes `integrations.connection.deleted`, and Projects removes the matching scopes.

- 3fe51c3: Events and runs stay inside their project's access.

  - **Events:** the integration event envelope has an optional `resource`. GitHub and Gitea fill it with the repository of the event.
  - **Triggers:** a workflow or listening job in a project whose access excludes the connection or the repository no longer receives the event. The trigger history records the decision as `filtered`, with the reason `project-access`, or `project-deleted` when the project is gone. Dev runs that replay an event apply the same check. The job-activated event and listener subscriptions now carry the project.
  - **Agent:** a request or message for a project that excludes the connection is dropped with `project-access` or `project-deleted`, and no other project answers it.
  - **Shipfox tools:** `start_workflow_run` no longer takes `project_id` and starts runs only in the caller's project.

- 107ecc7: Prepares Slack for agents. The Slack app now requests `chat:write.customize` and `assistant:write`, and Slack publishes the agent view events `assistant_thread_started`, `app_context_changed`, and `agent_session_stopped` without adding them to the workflow event catalog. A provider can implement `connectionReconnectRequired` to report an active connection that lacks a newer permission. The connections list then returns `reconnect_required`, the connection page asks the user to reconnect, and agents ignore the connection's events until it reconnects. Slack reports this for an installation that lacks a required scope.
- e2e561c: Reads source files as strict UTF-8 and lists symlinks and submodules. Fetching a file that is not valid UTF-8 now fails with the `binary-file-unsupported` reason instead of replacing invalid bytes. Source file listings now report `symlink` and `submodule` entries next to `file` entries. Workflow sync ignores those entries and reports a workflow file that is not UTF-8 text as an invalid definition for that file.
- 9485c57: Adds the `checkTemplateConformance` inter-module operation. It checks the tool and event references of a composed workflow template against the integration catalog of the instance. It returns one issue for each reference that the instance cannot serve.
- 82f2480: Adds a `json` or `file` result kind to agent tool catalog entries. An absent kind means `json`. The connection tool catalog and the agent tools context carry the resolved kind, and the MCP gateway neither lists nor calls file tools.

### Patch Changes

- 0363a2c: Run admission rejects a `repository:` checkout without a connection on a managed project that has no default checkout when the project's default connection is missing or not active. `listSourceControlConnectionIds` also returns `inactiveConnectionIds`.
- Updated dependencies [8937e15]
  - @shipfox/regex@0.4.0

## 31.0.0

### Major Changes

- da1114b: Group integration event catalogs into families that carry the payload kind, a JSON Schema of normalized payloads, and family notes. Event entries now reference their family and no longer carry `emittedWhen` or `payloadKind`. Sentry and custom webhook DTOs export the Zod schema of the normalized `event` value.

## 30.0.0

### Minor Changes

- f05d344: Adds the flag-gated Notion provider scaffold. The stored-request contract accepts the Notion webhook route. The seed contract requires UUID identifiers. Workflow failure annotations show the Notion provider name.

## 27.2.0

### Minor Changes

- 0827733: Reserves the `shipfox` connection slug for built-in providers and passes optional caller context to provider tool calls through `OpenAgentToolsSessionInput`.

## 26.0.0

### Minor Changes

- 6eaacf0: Adds workspace-scoped integration connection and provider tool-catalog reads.
- db054aa: Records the authenticated initiator on availability events from OAuth or installation flows for GitHub, Jira, Linear, Sentry, and Slack. Direct-connect and manual webhook paths are not included. Background and lifecycle reactivation events remain unattributed.
- 4a75c26: Add the signed, connection-scoped ClickUp webhook receiver and event ingestion with delivery deduplication and loop safety.

## 22.0.0

### Minor Changes

- c392dfb: Adds typed synthetic listener dispatch and shared payload limits for production-shaped E2E coverage.

## 21.0.0

### Major Changes

- 5886bf2: Make selected repository access project-only and remove manual repository grants.

### Minor Changes

- b6298b8: Adds Test VCS credential invalidation, refresh controls, and shared E2E setup DTOs.

## 20.1.0

### Minor Changes

- bb334f7: Add workspace-admin mutation routes for repository access modes and manual grants.
- 7467ee6: Add the composed repository-access read route for integration connections.

## 20.0.0

### Major Changes

- db83e6c: Enforces the declared repository scope for integration tool calls so denied or partially unauthorized multi-target calls never open a provider session.

### Minor Changes

- ec39327: Projects checkout resolution now requires a project ID and no longer accepts repository names. Checkout requests authorize the repository target before issuing credentials. Repository declarations remain valid without a project association.

### Patch Changes

- 351f02c: Build GitHub issue and pull request search queries from server-owned repository scope, driven by a new repository-scope classifier on agent tool catalog entries.

## 19.0.0

### Major Changes

- a52cd6d: Adds checkout targets addressed by stable external IDs or owner/name declarations. Checkout inputs reject ambiguous targets and caller-supplied metadata.

### Minor Changes

- 75a54d1: Adds the repository authorization contract with exact-ID/name target resolution and its authorization error codes. Checkout now surfaces repository-authorization failures as not-granted (404), ambiguous (409), and store-unavailable (503) errors.

### Patch Changes

- b416c4c: Preserves existing package behavior while simplifying internal control flow.
  - @shipfox/inter-module@0.2.3
  - @shipfox/regex@0.3.0

## 18.0.0

### Minor Changes

- b2aad90: Adds `generation` and `renewal` checkout-credential fields and `createCheckoutCredentials`, which accepts the frozen connection, stable repository ID, exact permissions, and rejected generation.

## 16.0.0

### Minor Changes

- 568c90b: Adds the inter-module `callTool` method for server-executed integration tool calls, tagged with the caller on the audit line and the `integrations_agent_tool_call` metric.

## 15.0.0

### Patch Changes

- Updated dependencies [a7804a8]
  - @shipfox/regex@0.3.0

## 14.0.0

### Major Changes

- 18e9bad: Adds source-control ref resolution that pins branch and tag names to commits.

### Minor Changes

- c44641f: Adds provider capabilities to the `integrations.connection.available` event, so subscribers can tell a tool connection from a source-control connection. The publisher now carries the capabilities the connection DTO already exposes.
- 1b71a66: Exposes each provider's event catalog and the fixed-event providers on the integration validation context. Every provider now refuses the reserved `manual` and `cron` connection slugs.

## 12.2.0

### Minor Changes

- 7901a60: Retry workspace workflow definition syncs when an integration connection becomes available.

## 12.0.0

### Major Changes

- 54c820e: Capture the actor that caused a source-control event on the normalized trigger reference. `TriggerReference` gains a required `actor`, resolved from the webhook sender by the GitHub and Gitea providers and null for payloads that name none.

### Minor Changes

- f13e8bb: Add Jira dynamic webhook registration and authenticated event ingestion through
  the shared stored-webhook workflow. Update the SPI webhook request exports and
  serialize Jira installation replacement across API replicas. Preserve Jira
  delivery identifiers and require lifecycle callbacks for registration. Remove
  the unused Jira webhook signing-secret configuration and allow HS256 verification
  at a supplied receipt time.
- 869a792: Refresh source-backed project repository identity from GitHub repository and installation-repository events.
- 032d316: Scope checkout credential minting to the currently running checkout step and return its fetch depth.
- cb0abfa: Expose the normalized trigger project, repository, ref, and commit in workflow context.

### Patch Changes

- Updated dependencies [f78740d]
  - @shipfox/inter-module@0.2.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/inter-module@0.2.2

## 9.0.1

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [475ce59]
  - @shipfox/inter-module@0.2.1

## 9.0.0

### Major Changes

- 02974d6: Removes executable policy and test fixtures from public API DTO roots.
- 4a6d124: Separates Integrations provider SPI contracts from the public DTO surface.

### Patch Changes

- @shipfox/inter-module@0.2.0

## 8.0.0

### Major Changes

- 7f227c6: Moves Projects and Integrations synchronous contracts to producer-owned inter-module entry points.

## 6.0.0

### Minor Changes

- 0bb82a4: Adds the Agent and Integrations inter-module APIs, moving Workflows agent configuration, runtime credential resolution, and integration consumers behind producer-owned clients.
- f262539: Adds a composed webhook processor and optional provider-neutral delivery source for hosted API runtimes.
- 3bb4e26: Fixes composed webhook processing and exposes Slack URL-verification responses through the shared contract.
- 4604a06: Adds the shared versioned inbound webhook request and processing contracts.

### Patch Changes

- Updated dependencies [81f9544]
  - @shipfox/inter-module@0.2.0

## 5.0.0

### Minor Changes

- 2875241: Adds deduplicated Slack installation revocation for app uninstall and bot token-revocation events.
- fb70438: Cascades provider installation and token deletion when removing a connection.

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 3.0.0

### Minor Changes

- 6b23868: Adds provider event and GitHub agent-tool catalogs for generated integration reference documentation.

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

## 0.1.0

### Minor Changes

- 115655e: Moves source-event translation to the integration module: source-control providers emit a typed, provider-agnostic `INTEGRATION_SOURCE_COMMIT_PUSHED` event via one transactional publisher, projects subscribes to it instead of decoding GitHub payloads, and branch-deletion pushes are dropped at the source.
- b8e49ff: Add the client-side Sentry install/connect flow and a workspace settings
  integrations hub.
  - `@shipfox/client-integrations`: shared `IntegrationGallerySection` (capability
    filter, lifecycle pills, "Added" date, external link, connected-first
    ordering, degraded status mode), shared `RedirectInstallPage` powering the
    GitHub and new Sentry install pages, `SentryCallbackPage` with an explicit
    workspace confirm (sessionStorage only pre-selects), two-tier retry, and the
    Sentry hooks (`useCreateSentryInstallMutation`, `connectSentry`,
    `useIntegrationConnectionsQuery`).
  - `@shipfox/client-workspace-settings`: new `/workspaces/$wid/settings/integrations`
    page and an Integrations entry in the settings nav.
  - `@shipfox/client-router`: routes for the Sentry install page, the root-level
    Sentry callback, and the settings integrations page.
  - `@shipfox/react-ui`: `sentry` icon (monochrome, theme-aware).
  - `@shipfox/api-integration-core-dto`: optional `external_url` on the connection
    DTO and an optional `connectionExternalUrl` method on `IntegrationProvider`.
  - `@shipfox/api-integration-core`: `GET /integration-connections` now returns
    connections of every lifecycle status (the active-only filter prevented
    clients from surfacing disabled/error state) and resolves `external_url`
    per connection best-effort.
  - `@shipfox/api-integration-sentry` / `@shipfox/api-integration-github`:
    implement `connectionExternalUrl` (Sentry org URL via a new
    by-connection-id installation lookup; GitHub installation settings URL).

- d6d4862: Add a Sentry integration provider that ingests issue webhooks.
  - New `@shipfox/api-integration-sentry` + `-sentry-dto` packages: a webhook
    receiver that verifies the HMAC-SHA256 signature (keyed with the app client
    secret), dedups on `Request-ID`, normalizes the issue payload, and publishes
    `integrations.event.received` with `source: 'sentry'` and `event:
issue.<action>`. A raw `ignored` action is normalized to `archived`. Malformed,
    bad-JSON, unknown-action, and unknown-resource deliveries are recorded-and-dropped
    with a 204 (deliberate deviation from GitHub's 400 to avoid Sentry disabling the
    webhook).
  - `@shipfox/api-integration-core-dto`: add the `SentryIssuePayload` contract.
  - `@shipfox/api-integration-core`: register the Sentry provider behind
    `INTEGRATIONS_ENABLE_SENTRY_PROVIDER`, add the
    `updateIntegrationConnectionLifecycleStatus` helper, and pin stable
    migration-tracking table names per provider database.
  - `@shipfox/node-fastify`: add the shared `rawBodyPlugin` and `WEBHOOK_BODY_LIMIT`
    exports for webhook receivers.
  - `@shipfox/node-module`: add an optional `migrationsTableName` to `ModuleDatabase`
    so conditionally-composed databases get a position-independent migration table.
  - `@shipfox/api-integration-github`: consume the shared `rawBodyPlugin` instead of
    a local copy (internal refactor, no behavior change).

  Deploy note: environments with GitHub enabled must rename the existing
  `__drizzle_migrations_integrations_1` table to
  `__drizzle_migrations_integrations_github` as part of this release, or GitHub
  migrations re-run against existing tables.

### Patch Changes

- ce062a9: Validates authored agent step integrations against provider tool catalogs and workspace connection capabilities.
- f3614ae: Add `createCheckoutSpec()` to the integration source-control service and the GitHub provider. GitHub mints a short-lived, repo-scoped installation access token and returns it as structured `CheckoutCredentials` alongside a clean `repositoryUrl`; the secret is never embedded in the URL. `ref` defaults to the repository default branch, providers without checkout support raise a typed `IntegrationCheckoutUnsupportedError`, and a `redactCheckoutSpec()` helper masks the token for logging. Dormant until the checkout-token endpoint and runner enrichment are wired in; no runtime behavior changes yet.
- f8f339a: Add the `@shipfox/redact` package with shared credential-redaction helpers: `redactUrlCredentials` (scheme-agnostic free-text scrubber), `stripUrlCredentials` (structured single-URL stripper), `redactSecrets` (literal-secret scrubber), and the `REDACTION_PLACEHOLDER` constant. Move `redactCheckoutSpec` from `@shipfox/api-integration-core-dto` into `@shipfox/api-integration-core` so it can reuse the shared `stripUrlCredentials` without breaking the dto-only-dependency rule; its public export path (`@shipfox/api-integration-core`) is unchanged. No behavior change.
- 01be723: Adds a shared GitHub installation token provider with broad REST minting, in-memory reuse, refresh-margin reminting, single-flight dedupe, and a missing-installation provider error reason.
- 2933c33: Adds drain-boundary Zod validation for current outbox publisher event payloads.
