# @shipfox/api-agent

## 34.0.0

### Major Changes

- 530d00f: Credentials and usage can name a conversation instead of a step attempt, so inference no longer requires a run.

  - **Credentials:** `resolveRuntimeCredentials` and `ManagedModelProvider.resolveCredentials` take a `subject` in place of `runId`, `stepAttemptId`, and `jobIdentity`. `InferenceSubject` has the kinds `step_attempt` and `conversation`, and a conversation names its `agentKey`. A composing application's managed provider must read the IDs from `subject`.
  - **Usage:** `InferenceSegmentInputDto`, `InferenceSegmentUsageDto`, and `usage.inference_segment.recorded` are unions of a step segment, with the IDs down to the step attempt, and a conversation segment, with a `conversationId` and the `agentKey` of its agent, so usage can be measured per agent. The schemas and a database check reject anything else, and a consumer must handle a segment with no run. `StepInferenceSegmentInputDto` names the step variant, and `inferenceSegmentStepIdentity` returns the run identity of a stored row. Conversation segments skip the job execution projection check, and their events order on the conversation ID. The run and job execution routes don't change.
  - **Project ownership:** `createUsageModule` takes a `projects` client. Usage confirms that a conversation segment's project isn't in another workspace before recording it, and a mismatch fails the batch.
  - **Agent:** `@shipfox/api-agent` exports `builtInAgentConfigInput`, which `resolveAgentConfig` takes in place of a step. `renewal` now covers any later credential for admitted work, so the model and summary calls after a turn's first model call skip the availability check.

### Minor Changes

- 2062ec8: An agent in a Slack or Linear conversation starts workflow runs. `fireManualTrigger` accepts a conversation with a provider and no user as an agent actor, and `start_workflow_run` no longer needs a Shipfox user for such a conversation. The run budget still applies. The run page reads "Started by Shippy in Slack", and Linear shows the run link on the agent session. Web conversations still record their author.
- 04bf72a: Puts Shippy, the project chat, behind the `agent-chat` flag. The flag defaults to off, so a composition shows no Shippy until `FLAG_AGENT_CHAT=true` is set on the API or its flag provider turns it on for a user or workspace. The conversation routes stay served. A full Agent module replacement must declare `agentFlags` in its `flags`, or the flag is not served.

  `defaultModules` adds `GET /feature-flags`, which serves every flag declared with `client: true` for the signed-in user and workspace. `@shipfox/client-shell/runtime` adds `useFlag()`, which refetches every 60 seconds, and `@shipfox/client-shell/testing` adds `seedFeatureFlags()`. A project dock contribution can declare `useAvailable`, and the shell hides the launcher, the dock, and the placement control while it returns `false`.

- 4227bda: Store private web conversations and expose their API.

  - **Storage:** a conversation is an append-only timeline of pi session entries, stored unchanged, so thinking and signatures survive.
  - **Privacy:** entries, titles, and stream chunks are encrypted with the workspace data key. System entries, page notes, and signatures never reach a client.
  - **Routes:** list and create under `/projects/:projectId/conversations`, and get, read items, post a message, mark read, and delete under `/conversations/:conversationId`. Anyone but the owner gets a 404.
  - **DTOs:** `@shipfox/api-agent-dto` exports the conversation schemas and a closed `pageContextSchema`. Items carry `SessionView` rows, or dedicated run result and turn notice DTOs.
  - **Composition:** `createAgentModule` accepts an optional `projects` client. The conversation routes are mounted only when it is present, so a custom `agentModuleFactory` must forward it.

- 610ab29: A new Slack or Linear request goes to the agent whose `on:` rule matches it, with one agent per conversation.

  - **Matching:** for a request, Triggers evaluates the agent subscriptions on the event's source, with each filter reading `request` and `event`, and passes the matches to `routeInteraction` as `candidates`. Follow-ups and stops match no rule.
  - **Owner:** Agent starts the conversation with the first candidate whose project takes the connection: custom agents before Shippys, and the earliest binding first within each group. Without one, the default Shippy answers, as before. A key that already has a conversation keeps it.
  - **Contract:** `routeInteraction` takes an optional `candidates` list and can return the new outcome `matched`, with the winning `subscriptionId` and the `ambiguousSubscriptionIds` of the other candidates.
  - **Decisions:** an `agent` decision can now name an agent subscription. The winning rule is recorded as `owner`, the others as the new outcome `ambiguous`, and a rule whose filter fails as `filter-error`. Migration `0008_agent_rule_decisions` relaxes the decisions check constraint, and the decision DTOs accept an `agent` decision with a subscription ID. The `get_trigger_event` tool schema includes `ambiguous`.
  - **Docs:** the `on` field description and the workflow schema reference describe how requests are routed.

- 50704f7: Adds turn admission, stop, retry, and a recovery sweep to agent conversations. A turn start checks the owner's membership and the workspace state, then the optional `admission.policy` of `createAgentModule`, and a workspace-state or policy denial writes a `turn_notice` instead of opening a turn. An owner who left the workspace gets no notice and no turn. `POST /conversations/:id/stop` stops a reply and keeps the partial message. `POST /conversations/:id/retry` runs a failed or denied turn again. The recovery sweep wakes conversations with queued inputs or a requested retry. `createAgentModule` now needs `workspaces` to run turns, and `defaultModules` passes it.
- c10e4c4: Streams conversation turns to the browser over server-sent events.

  - **Agent:** `GET /conversations/:conversationId/stream?after_seq=<n>` sends `queued`, `item`, `delta`, `reset`, and `turn` events, with a comment heartbeat every 15 seconds. It closes when the turn ends or after 5 minutes. A reconnect gets a `reset` and the running call's text from its first chunk. Browser origins that the API allows can read it.
  - **Agent DTO:** `conversationStreamQuerySchema` and `conversationStreamEventSchema` describe the request and the events.
  - **Client API:** `checkedApiEventStream` opens an event stream with `fetch` and the bearer token, and validates each message.

- 18678ea: A run started from a conversation now reports its result back to that conversation, even days later.

  - **When:** the result arrives when the run settles, meaning its one-shot jobs finished and a listener keeps it open, or when it ends. A cancelled or timed-out run never looks settled, and a very large run reports only when it ends. Each attempt reports once, and a rerun reports its own result.
  - **Reliability:** a result that failed to arrive is delivered once the fault clears, and a check that stayed requested for over a minute is run again by the next recovery sweep.
  - **Shippy:** reads the finished jobs at settled to find outputs such as `pr_url`, and reports an ended run's outputs with its status.
  - **Integration:** `@shipfox/api-agent-dto` adds the `registerConversationRun` inter-module method, which `start_workflow_run` calls for a conversation. `createAgentModule` now needs the `workflows` client to deliver results.

- 2339c1b: A conversation can start workflow runs, with a limit on how many it starts without a person writing.

  - **Start tool:** `start_workflow_run` is now offered to conversations. It starts a root run in the conversation's project for the conversation owner, and its idempotency key is `conversation:<conversationId>:<callItemId>`, so a repeated call returns the same run. The conversation caller context now carries `agentKey`.
  - **Run budget:** `claimConversationRunStart` on the agent inter-module contract spends one of five run starts. A message from a person resets the count. At the limit, the tool returns `run-budget-exhausted` and tells the agent to ask the user. A repeated call doesn't spend the budget again.
  - **Manual trigger:** `fireManualTrigger` and the manual trigger payload take an optional `conversation` with `id`, `agentKey`, and `provider`. The workflows inter-module contract gains `hasRunForIdempotencyKey`.
  - **Run reads:** run list items and the run overview header return `conversation` with `agent_key`, `provider`, and `author_user_id`, and never the conversation id.
  - **Client:** the run list shows `via Shippy`, the run summary shows `Started by <author> via Shippy`, and the chat shows a `Run started` row that never joins a group of reads. The panel copy and suggested prompts say that Shippy can start work.
  - **Shippy prompt:** a conversation pinned before this change says it can't start runs and suggests a new conversation.

- dd63da9: Gives every workspace a default project that answers the Slack and Linear requests no other agent claims.

  - **Projects:** a new workspace gets an empty managed project named Default. A workspace made before this release gets its own when the first page of its project list is read without a search, or when its default project is read, so no backfill step is needed. A renamed default keeps its flag.
  - **Contract:** projects carry `is_default` (`isDefault` between modules), and `getDefaultProject` returns the default project of a workspace.
  - **Agent:** an unclaimed request starts a conversation in the default project, not the oldest one.
  - **Client:** the projects hub, the project switcher, the project breadcrumb, and the project settings show a Default badge. The setup gate ignores the default project when it checks whether a workspace has a project.

- b92d2a8: An agent file can grant integration tools with `integrations:`, using the selectors and `allow_write` rule of an agent step.

  - **Sync:** definition sync checks the selectors, connections, and `allow_write` of each agent file. An invalid file keeps its last valid version.
  - **Conversations:** the tools of a granted connection appear beside the built-in tools, named by connection. Tools that return files or images are left out. A tool removed from the file stops being callable.
  - **Write tools:** a write call is recorded before it runs. A retry that finds it started does not run it again. It stores a result with the outcome `unknown`, and the model reads the state before it tries again.
  - **Integrations:** the new `resolveAgentTools` operation expands selectors into tool grants. `getAgentToolsContext` no longer needs a default connection.

- a99c11b: Show managed models that a workspace cannot run. The workspace model catalog marks them `locked`, validation warns with `model-locked` and never rejects, and the model lists mark them with a lock and explain the reason once, with the required action, while keeping them selectable.
- a48410e: Purges the configuration and conversations of a deleted project. After a project is deleted, its subscriptions, definitions, secrets, cache entries, conversations, and managed repository are removed, and a late event can't bring any of them back. A write for a deleted project answers `project-not-found`. A repository the project linked is not touched, and action snapshots stay, because projects in a workspace share them.
- 1a50666: Project agent files now shape conversations, and a project can have custom agents.

  - **Built-in agent:** the `instructions` of `shippy.yaml` append to the pinned system prompt of a new conversation. Its `provider` and `model` apply from the next turn. A running conversation keeps its prompt.
  - **Custom agents:** a conversation can start with `agent_key` set to a custom agent, which uses its own full prompt. The conversation stores the agent file's content hash. A deleted agent leaves its conversations readable and refuses new messages and retries.
  - **API:** `GET /projects/:projectId/agents` lists the built-in agent and the custom agents with any file error. `createAgentModule` takes an optional `definitions` client.
  - **Chat panel:** a picker appears in a new conversation when the project has custom agents. The panel shows an invalid agent file and a deleted agent.

- 3fe51c3: Events and runs stay inside their project's access.

  - **Events:** the integration event envelope has an optional `resource`. GitHub and Gitea fill it with the repository of the event.
  - **Triggers:** a workflow or listening job in a project whose access excludes the connection or the repository no longer receives the event. The trigger history records the decision as `filtered`, with the reason `project-access`, or `project-deleted` when the project is gone. Dev runs that replay an event apply the same check. The job-activated event and listener subscriptions now carry the project.
  - **Agent:** a request or message for a project that excludes the connection is dropped with `project-access` or `project-deleted`, and no other project answers it.
  - **Shipfox tools:** `start_workflow_run` no longer takes `project_id` and starts runs only in the caller's project.

- a15e118: Lets a managed model provider refuse a model for one workspace at run time. A provider opts in by implementing `availability`, which returns the workspace's locked models. A locked model fails the step with a 422 `agent-model-unavailable` response and a policy notice. An error from `availability` returns a retryable 503. Credential renewal doesn't recheck, so a running step is never cut off. The stored step error carries the notice, and the model unavailable callout shows its message and required action. Providers without `availability` behave as before.
- 52969e5: Runs agent conversation turns on Temporal, with model calls on the server and no runner.

  - **Agent:** `createAgentModule` takes an `integrations` client. With it and `projects`, the module runs one `agentConversationWorkflow` per conversation on the `agent-conversation` queue. Its activities rebuild each prompt from the stored pi entries, stream the reply, run tools through `integrations.callTool`, and store each result once. The first entry pins the base prompt and tools. A turn stops after 25 model calls.
  - **Server:** the default composition passes the Integrations client to Agent.
  - **Module:** a worker can set `maxConcurrentActivityTaskExecutions`.
  - **Egress guard:** `assertEgressAllowed` takes an optional `lookup`, so a caller can check the addresses it connects to.
  - **Templates:** `getBuiltInAgentPrompt` reads the base prompt of a built-in agent. The package embeds `assets/agents/shippy.md`.

- 307add3: Compacts long conversations with pi's compaction. A prompt that nears the context window, or that a provider rejects as too long, is summarized before the model call repeats. The timeline keeps every entry, and only the prompt shrinks. A second compaction for the same call fails the turn with a notice to start a new conversation.
- acfb16d: Adds reply delivery for conversations started from an integration. After each turn, Agent asks the provider to send the answer, or an error when the turn failed or was denied, and a stopped turn sends its partial text or "Stopped.". A turn with no text sends "Done.". Each tool call is reported as working, and when a turn ends Agent makes a best-effort attempt to clear the provider's progress on providers that support it. A `stop` interaction asks the running turn to stop. A reply the provider can't take is recorded as a notice on the conversation and is not retried. A crash between the provider accepting a reply and Agent recording it can send the reply twice. Providers that implement the interaction capability don't send replies yet.
- 25fd5a8: Routes requests from integrations that support interactions to agents. An unowned request starts a conversation with the Shippy of the workspace's default project. A request on an owned key, a follow-up, or a stop reaches the conversation that owns its key, and a follow-up or stop with no owner is dropped. A replayed event creates one conversation. Triggers records each result as an `agent` decision: `owner`, `default`, or `dropped`. Agent adds `routeInteraction` and the origin columns on conversations.
- a436d9c: The `shipfox` provider gains six read tools, so a conversation or an agent step can troubleshoot a run.

  - **New tools:** `list_workflow_run_jobs`, `get_workflow_job`, `list_workflow_step_attempts`, `list_workflow_run_job_explanations`, `get_workflow_definition_source`, and `search_docs`. `get_workflow_job` returns the job outputs, such as `pr_url`.
  - **`@shipfox/api-integration-shipfox`:** `createShipfoxAgentToolsProvider` takes a required `docs` cache. A conversation caller can't read a run, job, step, or definition from another project.
  - **`@shipfox/api-integration-core`:** the inter-module clients for providers include the docs cache.
  - **`@shipfox/actions`:** the generated tool types include the new tools.
  - **`@shipfox/api-agent`:** adds `createReadSkillTool`, an Agent-local `read_skill` tool that reads shipped skills.

- 3d329a9: Add the Shippy chat panel beside every project page.

  - **Client chat:** a new package. `chatFeature` contributes the project dock: a panel with a transcript, tool rows, a composer with the page the agent sees, history with delete, and every turn state from thinking to a deleted conversation. `Mod+.` opens or closes it.
  - **Client features:** `defaultFeatures()` includes `chatFeature`.
  - **Client logs:** exports `groupActivityReads`, `ActivityReadGroupNode`, `ActionDetails`, and `actionDisplayLabel`.
  - **Client shell:** `useAgentPageContext()` accepts `undefined`, and its context gains `runNumber` and `name`, which only label the page for the reader.
  - **Agent:** `GET /conversations/:conversationId` returns `latest_turn`, with its status, failure code, and model.
  - **Agent DTO:** adds `conversationLatestTurnDtoSchema`, and `latest_turn` on `conversationDetailDtoSchema`.
  - **Client workflows and projects:** the runs, run, job, automations, and project settings pages tell Shippy where the user is.

- f5c364b: Shows each run result in a Shippy conversation as a card, lists the runs that have no result yet, and shows unread replies as a badge on Shippy. A settled run reads `Listening`. A reply is marked read only when its latest message is in view in a focused tab.
- d2a2168: Stops work for a deleted project and refuses new work. After a project is deleted, its open runs and listening jobs are canceled, its active turns stop with no reply in Slack or Linear, and no trigger, cron, manual fire, dev run, or rerun can start a run in it, including a job with `checkout: false`.

  - **Workflows:** every start path checks that the project is live before it creates a run. A refused start fails with the new `project-deleted` error on `startRunFromTrigger`, `startDevRun`, `rerunWorkflowRun`, and `deliverEventToJobListener`. `runWorkflow`, `runDevWorkflow`, and `rerunWorkflowRun` now require a `projects` client. The module adds `stopWork({scope, reason})`, a core function and an inter-module method that cancels the open runs in a workspace or project and returns how many remain. Its `PROJECT_DELETED` subscriber calls it. The run keeps the existing canceled status, with no deletion reason yet.
  - **Agent:** turn admission refuses a deleted project quietly, and the pinned prompt no longer falls back to an `unknown` project name. The module adds the same `stopWork` method. With `project_deleted` it marks the replies of the stopped turns `suppressed`, so nothing is posted back and the loading status is left alone. Its `PROJECT_DELETED` subscriber calls it.
  - **Triggers:** a `project-deleted` error from Workflows shows as the `project-deleted` decision diagnostic and as `project-not-found` on the manual-fire and dev-run routes. The command contracts list the new error.

- dd20040: Names the cause of a refused start when an agent step's configuration cannot be used. The agent `agent-config-invalid` error carries a `reason` (`model-unknown`, `provider-unsupported`, `harness-unsupported`, `thinking-unsupported` or `workspace-providers-disabled`) with the `model` and `provider` where they apply. `agent-config-unresolvable` passes them on with the job and step, in the inter-module error, the 422 `details` (`reason`, `model`, `provider`, `job_key`, `step`) and the trigger diagnostic. Every new field is optional, so stored diagnostics still map.
- 70e6983: Adds `managed_provider_id` to the `getWorkspaceModels` inter-module result, so consumers can tell the managed provider's models apart from bring-your-own-key providers.

### Patch Changes

- 1f218c4: Treats every runner as able to renew Git and managed inference credentials. The runner capability manifest no longer has `features`, and `runnerFeaturesSchema` and `RunnerFeaturesDto` are removed. Registration still accepts a `features` key from older runner images and ignores it. `ManagedModelProvider.resolveCredentials` no longer receives `renewableInference`, and `RUNNER_CAPABILITY_REQUIRED_ERROR_CODE` with its `runner-capability-required` error is removed. A composing application must stop using both and always issue renewable credentials. The API no longer writes the "Renewable Git credentials are unavailable on this runner" annotation.
- 68d6cd6: Adds lab and display label fields to workspace model contracts while preserving strict agent-access projections.
- 8a4f3d8: Adds the GET /__e2e/agent/sessions/:stepAttemptId route and exports the e2eSessionTranscriptResponseSchema/E2eSessionTranscriptResponseDto contract for decrypted agent session transcripts.
- 1a3882d: Finishes the purge of a deleted project's conversations and sessions when its `PROJECT_DELETED` event was dead-lettered. The Agent module runs the purge again every minute for deletion markers with no `purged_at`, so a turn that stops late no longer strands the project's rows.
- fe109f0: Naming a write tool in `include` now grants it. `allow_write` is no longer needed on agent steps, agent files, or action manifests.

  - **Schemas:** `allow_write` still parses on an integration and on an action manifest alias, so existing files keep working. It is marked deprecated and has no effect. A parsed manifest no longer defaults it to `false`.
  - **Sync:** definition sync no longer reports `integration-write-not-allowed`. A nested action alias must fit the selectors of the alias above it, with no separate write check.
  - **Workflow model:** `WorkflowModelStepIntegration` and `WorkflowModelActionIntegration` drop `allowWrite`.
  - **Integrations:** `resolveAgentTools` and `resolveAgentToolsBatch` drop the `allowWrite` input and the `write-not-allowed` reason. They also refuse the `*` selector, which definition sync already rejected, so every granted tool is named.
  - **Registry:** `derived.capabilities` drops `allow_write`, and versions published with it still parse. `diffActionCapabilities` no longer reports `write_enabled` or `write_disabled`, and `allow_write` no longer affects the minimum bump.
  - **Agent access:** `diff_registry_action` no longer returns `write_enabled` or `write_disabled` in `capability_changes`.
  - **Action tests:** `runAction` lets an action call every tool its manifest includes.
  - **Templates:** `ticket-to-pr` no longer sets `allow_write`.

- 3022de6: An `unknown` tool call error now says when the provider may have received the call. A write in a conversation with that error stores the outcome `unknown`, and an `unknown` error from a call the provider rejected, or one that failed before the provider was reached, stays an error.
- e679f38: New `@shipfox/node-pi-runtime` package builds a pi model from resolved runtime credentials.

  - **Package:** `createPiModel` builds a pi model from resolved runtime credentials. It comes with an in-memory credential store, custom provider registration, model resolution, managed stream recovery, and `AgentConfigError` for user-fixable configuration failures. The caller supplies the egress policy.
  - **`@shipfox/api-agent`:** depends on the package and on `@earendil-works/pi-coding-agent`. Nothing loads either at startup.

- e560f69: The Pi harness now runs on Pi 1.x.

  - **Agent DTO:** `piModelProviderId` maps a Shipfox provider ID to the Pi provider ID. Pi 1.x renamed `azure-openai-responses` to `azure`, and stored provider configs keep the Shipfox ID. `isReservedModelProviderId` now also reserves `azure`, so new custom providers cannot take Pi's built-in ID. The catalog lists Pi's new `meta`, `radius`, and `typesafe` providers as unsupported. Fireworks now defaults to `accounts/fireworks/models/kimi-k3` and Together AI to `deepseek-ai/DeepSeek-V4-Pro-0813`, because Pi removed the previous defaults.
  - **Agent:** Azure OpenAI model lists and credential checks use the renamed Pi provider again.

- 9186820: The `thinking` field of an agent file now sets the reasoning level of conversation turns.
- 9a899ff: A turn in an integration conversation that ends with no text now sends a short "Done." reply, so a Linear session no longer keeps its last tool call as the final activity. Slack gets the same reply.
- f0c4d9d: A write tool call in a conversation that times out, or fails on the last attempt after it began, now stores the outcome `unknown` instead of an error. The provider may have applied the write, so the model reads the state before it tries again.
- Updated dependencies [be33fe6]
- Updated dependencies [af0e24b]
- Updated dependencies [e99aa97]
- Updated dependencies [6b4ae32]
- Updated dependencies [46f78a0]
- Updated dependencies [2062ec8]
- Updated dependencies [04bf72a]
- Updated dependencies [4227bda]
- Updated dependencies [179fa81]
- Updated dependencies [24a18d3]
- Updated dependencies [7d20d04]
- Updated dependencies [610ab29]
- Updated dependencies [dc2bd62]
- Updated dependencies [3f1363c]
- Updated dependencies [8937e15]
- Updated dependencies [c5c454f]
- Updated dependencies [1f218c4]
- Updated dependencies [16d18f4]
- Updated dependencies [b97171d]
- Updated dependencies [5f88947]
- Updated dependencies [5a14986]
- Updated dependencies [9806da2]
- Updated dependencies [5588247]
- Updated dependencies [0363a2c]
- Updated dependencies [1fa56a2]
- Updated dependencies [ba1aff7]
- Updated dependencies [2526ccf]
- Updated dependencies [ba0d750]
- Updated dependencies [807ae57]
- Updated dependencies [4c789ca]
- Updated dependencies [c4f486b]
- Updated dependencies [d273097]
- Updated dependencies [7fddfc5]
- Updated dependencies [e087b95]
- Updated dependencies [68d6cd6]
- Updated dependencies [e1cfc2a]
- Updated dependencies [e64c10d]
- Updated dependencies [476e3b1]
- Updated dependencies [9d7c039]
- Updated dependencies [eb3f034]
- Updated dependencies [c0b814f]
- Updated dependencies [2cc76a9]
- Updated dependencies [0654280]
- Updated dependencies [175482e]
- Updated dependencies [c10e4c4]
- Updated dependencies [18678ea]
- Updated dependencies [2339c1b]
- Updated dependencies [7cc3735]
- Updated dependencies [b59424d]
- Updated dependencies [dd63da9]
- Updated dependencies [3b3e25c]
- Updated dependencies [fb79732]
- Updated dependencies [027e401]
- Updated dependencies [2e5a311]
- Updated dependencies [f05ecde]
- Updated dependencies [2d009f4]
- Updated dependencies [4273dad]
- Updated dependencies [8a4f3d8]
- Updated dependencies [cc644b8]
- Updated dependencies [b9a53b2]
- Updated dependencies [dc8065c]
- Updated dependencies [c06262b]
- Updated dependencies [24ea599]
- Updated dependencies [eab1dd7]
- Updated dependencies [8b16e92]
- Updated dependencies [184305a]
- Updated dependencies [205afb5]
- Updated dependencies [dcd0b79]
- Updated dependencies [cfd75e4]
- Updated dependencies [a73e712]
- Updated dependencies [48b8237]
- Updated dependencies [9e173c3]
- Updated dependencies [8a51054]
- Updated dependencies [b92d2a8]
- Updated dependencies [fe109f0]
- Updated dependencies [fdca5b6]
- Updated dependencies [530d00f]
- Updated dependencies [3022de6]
- Updated dependencies [f769d90]
- Updated dependencies [15b4274]
- Updated dependencies [593142d]
- Updated dependencies [f1f520f]
- Updated dependencies [cfe6ce6]
- Updated dependencies [ab66d1e]
- Updated dependencies [ef7cf4a]
- Updated dependencies [f7e0fb7]
- Updated dependencies [61b5524]
- Updated dependencies [b518893]
- Updated dependencies [8872f36]
- Updated dependencies [a99c11b]
- Updated dependencies [a64d96d]
- Updated dependencies [1872f3d]
- Updated dependencies [0af8bad]
- Updated dependencies [a020cbf]
- Updated dependencies [fc455ac]
- Updated dependencies [67e55ea]
- Updated dependencies [ecc70c2]
- Updated dependencies [6b01f3d]
- Updated dependencies [e679f38]
- Updated dependencies [af3b91f]
- Updated dependencies [f5bdc5b]
- Updated dependencies [e3b9558]
- Updated dependencies [e08530c]
- Updated dependencies [e560f69]
- Updated dependencies [9674325]
- Updated dependencies [21c993b]
- Updated dependencies [900a25a]
- Updated dependencies [cdb88a7]
- Updated dependencies [f8adab0]
- Updated dependencies [a26baf5]
- Updated dependencies [5ce9d5b]
- Updated dependencies [3869c1d]
- Updated dependencies [1a50666]
- Updated dependencies [55152c5]
- Updated dependencies [3fe51c3]
- Updated dependencies [c06262b]
- Updated dependencies [a15e118]
- Updated dependencies [52969e5]
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
- Updated dependencies [5fb1fbd]
- Updated dependencies [b1cc902]
- Updated dependencies [507915a]
- Updated dependencies [e6981d5]
- Updated dependencies [25fd5a8]
- Updated dependencies [97f6dab]
- Updated dependencies [2c36559]
- Updated dependencies [9906470]
- Updated dependencies [395e11d]
- Updated dependencies [2128c1e]
- Updated dependencies [041ae63]
- Updated dependencies [a429987]
- Updated dependencies [ebe3ac1]
- Updated dependencies [42829e8]
- Updated dependencies [3d329a9]
- Updated dependencies [f5c364b]
- Updated dependencies [3f1363c]
- Updated dependencies [d273097]
- Updated dependencies [9674325]
- Updated dependencies [107ecc7]
- Updated dependencies [15282f5]
- Updated dependencies [71c11b1]
- Updated dependencies [3c92a34]
- Updated dependencies [257e53e]
- Updated dependencies [e701cfc]
- Updated dependencies [94e77bc]
- Updated dependencies [2100749]
- Updated dependencies [9bac67e]
- Updated dependencies [f6bc1f4]
- Updated dependencies [651153a]
- Updated dependencies [d2a2168]
- Updated dependencies [dbe45d5]
- Updated dependencies [68ad557]
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
- Updated dependencies [c29a8bb]
- Updated dependencies [a32c90c]
- Updated dependencies [23a6b3a]
- Updated dependencies [8f54fc9]
- Updated dependencies [a4c05ba]
- Updated dependencies [c14f398]
- Updated dependencies [b0b0a82]
- Updated dependencies [82f2480]
- Updated dependencies [0b661c9]
- Updated dependencies [e71cded]
- Updated dependencies [6b2a308]
- Updated dependencies [2ab4025]
- Updated dependencies [0b661c9]
- Updated dependencies [70e6983]
- Updated dependencies [89a6cc7]
- Updated dependencies [9549da3]
- Updated dependencies [c9a7186]
  - @shipfox/workflow-document@4.0.0
  - @shipfox/api-definitions-dto@34.0.0
  - @shipfox/api-workflows-dto@34.0.0
  - @shipfox/api-secrets-dto@34.0.0
  - @shipfox/api-workspaces-dto@34.0.0
  - @shipfox/api-projects-dto@34.0.0
  - @shipfox/api-agent-dto@34.0.0
  - @shipfox/api-integration-core-dto@34.0.0
  - @shipfox/agent-transcript@0.1.0
  - @shipfox/api-auth-context@34.0.0
  - @shipfox/workflow-templates@2.0.0
  - @shipfox/node-object-storage@0.3.0
  - @shipfox/api-integration-shipfox-dto@34.0.0
  - @shipfox/node-postgres@0.6.0
  - @shipfox/node-fastify@0.5.0
  - @shipfox/node-module@1.2.0
  - @shipfox/node-pi-runtime@0.1.0
  - @shipfox/node-drizzle@0.4.0
  - @shipfox/node-opentelemetry@0.7.0
  - @shipfox/node-egress-guard@0.2.0
  - @shipfox/policy-notice@0.1.0
  - @shipfox/node-temporal@0.6.0
  - @shipfox/node-error-monitoring@0.4.1

## 33.0.0

### Patch Changes

- f24d9cd: Recover completed attempts' session claims before dispatching the next writer, so delayed background releases do not fail sequential agent steps.
- Updated dependencies [f24d9cd]
  - @shipfox/api-agent-dto@33.0.0
  - @shipfox/api-workflows-dto@33.0.0

## 32.2.0

### Minor Changes

- 3494bf1: Adds a `default` thinking option that requests the provider default without applying workspace or deployment overrides.

### Patch Changes

- Updated dependencies [3494bf1]
  - @shipfox/workflow-document@3.10.0
  - @shipfox/api-agent-dto@32.2.0
  - @shipfox/api-workflows-dto@32.2.0

## 32.1.0

### Patch Changes

- Updated dependencies [fd261c8]
  - @shipfox/api-agent-dto@32.1.0
  - @shipfox/api-workflows-dto@32.1.0

## 32.0.0

### Major Changes

- e87d5a9: Replaces singular model reference values with measured variants per supported thinking level in workspace model reads.

### Patch Changes

- Updated dependencies [e87d5a9]
- Updated dependencies [212c6b6]
  - @shipfox/api-agent-dto@32.0.0
  - @shipfox/api-workflows-dto@32.0.0

## 31.0.0

### Minor Changes

- 792fc53: Adds model reference data, pricing, harness settings, and attribution to workspace model reads.
- 3633ccc: Add a shared read of configured workspace models and the workspace default model, returning {models, default_model}.

### Patch Changes

- Updated dependencies [17d86bf]
- Updated dependencies [792fc53]
- Updated dependencies [3633ccc]
- Updated dependencies [bab2786]
- Updated dependencies [c5c7fa3]
- Updated dependencies [9e170c7]
- Updated dependencies [bcd9232]
- Updated dependencies [bd03ee1]
  - @shipfox/workflow-document@3.9.0
  - @shipfox/api-agent-dto@31.0.0
  - @shipfox/api-workflows-dto@31.0.0
  - @shipfox/api-secrets-dto@31.0.0

## 30.0.0

### Patch Changes

- Updated dependencies [c0c5653]
- Updated dependencies [b734fcf]
  - @shipfox/api-secrets-dto@30.0.0
  - @shipfox/api-workflows-dto@30.0.0

## 29.1.0

### Minor Changes

- d12820f: Publishes complete canonical workflow and step identity through managed inference credentials.

### Patch Changes

- Updated dependencies [d12820f]
  - @shipfox/api-agent-dto@29.1.0
  - @shipfox/api-auth-context@29.1.0
  - @shipfox/api-workflows-dto@29.1.0

## 29.0.0

### Major Changes

- b891938: Backfills NULL job snapshots to false and denies renewable-inference credential resolution with runner-capability-required when a runner lacks the capability.

### Patch Changes

- Updated dependencies [a34066f]
- Updated dependencies [e7a8fe4]
- Updated dependencies [f4f1f10]
- Updated dependencies [f571b7f]
- Updated dependencies [b891938]
  - @shipfox/node-fastify@0.4.7
  - @shipfox/api-workflows-dto@29.0.0
  - @shipfox/node-drizzle@0.3.6
  - @shipfox/workflow-document@3.8.0
  - @shipfox/api-agent-dto@29.0.0
  - @shipfox/api-auth-context@29.0.0
  - @shipfox/node-module@1.1.2

## 28.0.0

### Patch Changes

- Updated dependencies [e8f0212]
- Updated dependencies [d62e17e]
- Updated dependencies [7067bc3]
  - @shipfox/api-workflows-dto@28.0.0

## 27.2.0

### Patch Changes

- Updated dependencies [6ad8c2e]
- Updated dependencies [45cf692]
  - @shipfox/api-workflows-dto@27.2.0

## 27.1.0

### Patch Changes

- Updated dependencies [e0b7bd1]
  - @shipfox/api-workflows-dto@27.1.0

## 27.0.0

### Major Changes

- 45c9598: Removes `claude.auth_token` from the managed runtime contract and uses the shared API credential for Claude authentication.

### Patch Changes

- Updated dependencies [45c9598]
  - @shipfox/api-agent-dto@27.0.0
  - @shipfox/api-workflows-dto@27.0.0

## 26.1.0

### Patch Changes

- Updated dependencies [cb99d51]
- Updated dependencies [c2c97ac]
  - @shipfox/api-workflows-dto@26.1.0
  - @shipfox/node-error-monitoring@0.4.0
  - @shipfox/node-fastify@0.4.6
  - @shipfox/node-module@1.1.1
  - @shipfox/node-temporal@0.5.2
  - @shipfox/api-auth-context@26.1.0

## 26.0.0

### Patch Changes

- Updated dependencies [da717b1]
- Updated dependencies [5cb4279]
- Updated dependencies [fb73bca]
- Updated dependencies [8229356]
- Updated dependencies [aafce80]
  - @shipfox/api-workflows-dto@26.0.0
  - @shipfox/api-auth-context@26.0.0
  - @shipfox/node-module@1.1.0

## 25.0.0

### Major Changes

- 701df29: Expose missing renewable inference capability as a declared, bounded runtime credential error.

### Patch Changes

- Updated dependencies [00e2ce4]
- Updated dependencies [bba82ae]
- Updated dependencies [9e8b007]
- Updated dependencies [701df29]
  - @shipfox/api-workflows-dto@25.0.0
  - @shipfox/api-auth-context@25.0.0
  - @shipfox/api-agent-dto@25.0.0

## 24.2.0

### Patch Changes

- Updated dependencies [011d9ec]
- Updated dependencies [3cc2ffb]
- Updated dependencies [6100626]
  - @shipfox/api-workflows-dto@24.2.0

## 24.1.1

### Patch Changes

- @shipfox/api-workflows-dto@24.1.1

## 24.1.0

### Patch Changes

- Updated dependencies [d559bdb]
- Updated dependencies [c730a68]
- Updated dependencies [dd01977]
- Updated dependencies [cdc9dfe]
  - @shipfox/workflow-document@3.7.0
  - @shipfox/api-workflows-dto@24.1.0
  - @shipfox/config@1.3.0
  - @shipfox/api-auth-context@24.1.0
  - @shipfox/api-agent-dto@24.1.0
  - @shipfox/node-error-monitoring@0.3.1
  - @shipfox/node-fastify@0.4.5
  - @shipfox/node-object-storage@0.2.1
  - @shipfox/node-opentelemetry@0.6.6
  - @shipfox/node-postgres@0.5.2
  - @shipfox/node-temporal@0.5.1
  - @shipfox/node-module@1.0.11

## 24.0.0

### Patch Changes

- Updated dependencies [33f575e]
  - @shipfox/workflow-document@3.6.0
  - @shipfox/api-agent-dto@24.0.0
  - @shipfox/api-auth-context@24.0.0
  - @shipfox/api-workflows-dto@24.0.0

## 23.2.0

### Patch Changes

- @shipfox/api-auth-context@23.2.0

## 23.1.0

### Patch Changes

- @shipfox/api-auth-context@23.1.0

## 23.0.0

### Patch Changes

- Updated dependencies [7fed218]
- Updated dependencies [bd5acd2]
  - @shipfox/api-auth-context@23.0.0
  - @shipfox/api-workflows-dto@23.0.0
  - @shipfox/api-agent-dto@21.1.0
  - @shipfox/api-secrets-dto@12.0.0
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.3
  - @shipfox/redact@0.2.7
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-egress-guard@0.1.4
  - @shipfox/node-envelope-encryption@0.2.1
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-fastify@0.4.4
  - @shipfox/node-module@1.0.10
  - @shipfox/node-object-storage@0.2.0
  - @shipfox/node-opentelemetry@0.6.5
  - @shipfox/node-postgres@0.5.1
  - @shipfox/node-temporal@0.5.0
  - @shipfox/workflow-document@3.5.0

## 22.0.0

### Patch Changes

- Updated dependencies [c392dfb]
- Updated dependencies [e390533]
  - @shipfox/api-workflows-dto@22.0.0

## 21.2.0

### Patch Changes

- Updated dependencies [0745878]
- Updated dependencies [1f2c634]
- Updated dependencies [12cc22e]
- Updated dependencies [8407bd1]
  - @shipfox/node-module@1.0.10
  - @shipfox/node-temporal@0.5.0
  - @shipfox/api-workflows-dto@21.2.0

## 21.1.0

### Patch Changes

- f534da6: Snapshots renewable inference eligibility at job claim and rejects runtime credentials after cancellation or attempt replacement.
- Updated dependencies [01af160]
- Updated dependencies [f534da6]
- Updated dependencies [8a98a87]
- Updated dependencies [6fac62f]
  - @shipfox/api-workflows-dto@21.1.0
  - @shipfox/api-agent-dto@21.1.0

## 21.0.0

### Minor Changes

- ff45d70: Adds optional `projectId`, `jobId`, `jobExecutionId`, `stepId`, and `attempt` fields to managed provider credential resolution.
- b5d02d1: Adds renewable inference credential metadata, capability, and failure-reason contracts while preserving legacy behavior.

### Patch Changes

- e3afd72: Allows forked agent steps to continue sessions with their pinned harness when the step omits `harness`.
- Updated dependencies [12f7b10]
- Updated dependencies [ff45d70]
- Updated dependencies [e225f5e]
- Updated dependencies [cffa62d]
- Updated dependencies [b5d02d1]
- Updated dependencies [32e9fa0]
  - @shipfox/api-workflows-dto@21.0.0
  - @shipfox/api-agent-dto@21.0.0
  - @shipfox/workflow-document@3.5.0

## 20.4.0

### Patch Changes

- Updated dependencies [9a66057]
- Updated dependencies [0b32d1a]
  - @shipfox/api-workflows-dto@20.4.0
  - @shipfox/api-auth-context@20.4.0

## 20.3.0

### Patch Changes

- Updated dependencies [813a284]
  - @shipfox/api-workflows-dto@20.3.0

## 20.2.0

### Patch Changes

- Updated dependencies [ba481d6]
- Updated dependencies [ff63dcd]
- Updated dependencies [61f7b94]
  - @shipfox/node-fastify@0.4.4
  - @shipfox/api-workflows-dto@20.2.0
  - @shipfox/api-auth-context@20.2.0
  - @shipfox/node-module@1.0.9

## 20.1.0

### Patch Changes

- Updated dependencies [2bf937b]
- Updated dependencies [6207ce3]
- Updated dependencies [3ec04b0]
- Updated dependencies [5efaf93]
  - @shipfox/api-auth-context@20.1.0
  - @shipfox/api-workflows-dto@20.1.0
  - @shipfox/api-agent-dto@20.1.0

## 20.0.0

### Minor Changes

- 8f7cc71: Adds `CreateAgentModuleOptions` to `@shipfox/api-agent` and `agentModuleOptions`, `authModuleOptions`, and `runnersModuleOptions` to `defaultModules()` in `@shipfox/api-server`.

### Patch Changes

- Updated dependencies [ca7eb23]
- Updated dependencies [46ae6a8]
- Updated dependencies [fdfa0b2]
- Updated dependencies [af4a765]
- Updated dependencies [70f2eed]
  - @shipfox/node-object-storage@0.2.0
  - @shipfox/workflow-document@3.4.0
  - @shipfox/api-workflows-dto@20.0.0
  - @shipfox/api-auth-context@20.0.0
  - @shipfox/api-agent-dto@20.0.0

## 19.0.0

### Patch Changes

- c07c8e2: Preserves the pinned agent harness across workflow reruns.
- b416c4c: Preserves existing package behavior while simplifying internal control flow.
- Updated dependencies [34ebe6a]
- Updated dependencies [c07c8e2]
- Updated dependencies [b416c4c]
- Updated dependencies [93918a4]
  - @shipfox/api-workflows-dto@19.0.0
  - @shipfox/api-agent-dto@19.0.0
  - @shipfox/api-auth-context@19.0.0
  - @shipfox/node-egress-guard@0.1.4
  - @shipfox/node-envelope-encryption@0.2.1
  - @shipfox/node-module@1.0.8
  - @shipfox/redact@0.2.7
  - @shipfox/workflow-document@3.3.2
  - @shipfox/api-secrets-dto@12.0.0
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.3
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-fastify@0.4.3
  - @shipfox/node-object-storage@0.1.1
  - @shipfox/node-opentelemetry@0.6.5
  - @shipfox/node-postgres@0.5.1
  - @shipfox/node-temporal@0.4.6

## 18.0.0

### Minor Changes

- a6f242c: Applies each workspace's configured default harness when checking harness-specific tools, thinking, models, and shared sessions. Managed-inference workspaces using Pi can use Pi tool names without declaring the harness.

### Patch Changes

- Updated dependencies [151f750]
- Updated dependencies [a6f242c]
- Updated dependencies [b2aad90]
- Updated dependencies [a50e2dc]
- Updated dependencies [242bd21]
  - @shipfox/api-workflows-dto@18.0.0
  - @shipfox/api-agent-dto@18.0.0
  - @shipfox/api-auth-context@18.0.0

## 17.1.0

### Minor Changes

- fd6cee5: Ignores stored workspace provider defaults when an instance managed provider is available.
  Providerless steps still honor instance defaults and otherwise use the managed provider.
- fd6cee5: Allows managed catalog models to declare an optional `claudeModelId` for the Claude harness.
  Runtime resolution keeps the catalog model ID when the field is absent.

### Patch Changes

- Updated dependencies [fd6cee5]
  - @shipfox/api-agent-dto@17.1.0
  - @shipfox/api-workflows-dto@17.1.0

## 17.0.1

### Patch Changes

- Updated dependencies [a616842]
  - @shipfox/node-object-storage@0.1.1

## 17.0.0

### Major Changes

- 9f898d9: Replaces the logs-only `LOG_STORAGE_S3_*` base configuration with shared `OBJECT_STORAGE_S3_*` settings, per-consumer prefixes, and optional overrides, and adds encrypted agent-session transcript persistence. Self-hosters must migrate their S3 settings and provide `AGENT_SESSION_ENCRYPTION_KEK`; the DTO packages receive matching major versions for the API package-family release without DTO schema changes.

### Minor Changes

- ed4981e: Adds the lease-authed agent session transcript transport: `GET /runs/jobs/current/steps/:stepId/session` returns the decrypted, still-gzipped head snapshot with manifest headers (or a 204 no-head marker), and `POST .../session?attempt=N&base_segment=S` commits segment `S + 1` under the claim/base CAS with idempotent-retry acks and 409 conflicts. The routes resolve the leased step through a new workflows inter-module method (`getLeasedAgentSessionContext`); the artifact store enforces the session blob cap.
- 9f898d9: Persists encrypted agent session transcripts to object storage, adds a retention sweep that deletes expired sessions, and adds KEK rotation for envelope-encrypted artifacts. Deployments must set `AGENT_SESSION_ENCRYPTION_KEK` to a unique base64-encoded 32-byte key before upgrading.

### Patch Changes

- be5fb95: Upgrade Pi to 0.84.2, refresh its supported provider catalog and flagship defaults, expose current direct Anthropic models to the Claude harness, and allow Pi workflow steps to use `thinking: max`.
- Updated dependencies [a4f56ff]
- Updated dependencies [ed4981e]
- Updated dependencies [a591e8a]
- Updated dependencies [9f898d9]
- Updated dependencies [9f898d9]
- Updated dependencies [9f898d9]
- Updated dependencies [be5fb95]
  - @shipfox/api-auth-context@17.0.0
  - @shipfox/api-agent-dto@17.0.0
  - @shipfox/api-workflows-dto@17.0.0
  - @shipfox/node-postgres@0.5.1
  - @shipfox/node-envelope-encryption@0.2.0
  - @shipfox/node-object-storage@0.1.0

## 16.1.0

### Minor Changes

- d1fb0a3: Adds the agent session claim and carry-over inter-module methods (`claimSession`, `carryOverSessions`) with the session descriptor (`id`, `key`, `mode`, `segment`), so workflows can resume or fork a session and rerun attempts can carry sessions forward.

  Session claims are released automatically on step-attempt and job termination, with a stale-claim reap cron as a backstop.

  The previously required `jobLeaseTokenTtlSeconds` option on `createAgentModule` is removed; pass an optional `workflows` client to enable the job-terminated grace sweep.

### Patch Changes

- Updated dependencies [d1fb0a3]
- Updated dependencies [c1e5dfd]
- Updated dependencies [870523f]
  - @shipfox/api-agent-dto@16.1.0
  - @shipfox/api-workflows-dto@16.1.0

## 16.0.0

### Major Changes

- 03e03c7: Defines managed-provider `baseUrl` as a gateway mount root and normalizes it
  for client requests. Providers that previously returned client-ready bases must
  migrate to return the gateway root before upgrading.

### Patch Changes

- 9b7cdcc: Adds agent session persistence for resumable agent runs.
- Updated dependencies [03e03c7]
  - @shipfox/api-agent-dto@16.0.0

## 15.0.0

### Minor Changes

- 07410fe: Preserves Pi thinking-level mappings and provider compatibility metadata for managed models, so gateway-backed custom providers retain their model-specific reasoning behavior.

### Patch Changes

- 989eb11: Adds `managed_provider_id` and `instance_default_provider_id` to the model-provider catalog response so clients can detect when an installation provides inference and omit redundant provider setup.
- Updated dependencies [07410fe]
- Updated dependencies [989eb11]
  - @shipfox/api-agent-dto@15.0.0
  - @shipfox/node-opentelemetry@0.6.5
  - @shipfox/node-fastify@0.4.3
  - @shipfox/node-module@1.0.7
  - @shipfox/api-auth-context@15.0.0

## 14.0.0

### Minor Changes

- 09924ca: Adds optional model metadata (`context_window`, `max_output_tokens`, `reasoning`, `input_image`) to managed model entries and passes it through to the pi `custom_provider` contract so managed steps carry the same model descriptor as custom providers.

### Patch Changes

- Updated dependencies [09924ca]
  - @shipfox/api-agent-dto@14.0.0

## 13.1.0

### Minor Changes

- 0d3c2e3: Updates @shipfox/client-agent, @shipfox/client-onboarding, and @shipfox/client-workflows to show
  managed inference providers without exposing workspace credential setup, keep workflow examples
  limited to supported models, and explain managed-provider failures in workflow runs.
- 5c100d6: Adds support for injecting a managed hosted-inference model provider into agent configuration, with harness-compatible models and instance overrides taking precedence.
- ca91dc3: Adds managed-provider runtime credential resolution and lease-scoped wire fields for pi and Claude harnesses.
- 67aab38: Adds an instance policy that can restrict workspace model-provider configuration to an injected managed provider.

### Patch Changes

- Updated dependencies [0d3c2e3]
- Updated dependencies [5c100d6]
- Updated dependencies [ca91dc3]
- Updated dependencies [67aab38]
  - @shipfox/api-agent-dto@13.1.0

## 12.2.0

### Patch Changes

- @shipfox/node-opentelemetry@0.6.4
- @shipfox/api-agent-dto@12.2.0
- @shipfox/node-fastify@0.4.2
- @shipfox/node-module@1.0.6
- @shipfox/api-auth-context@12.2.0

## 12.0.0

### Minor Changes

- ee2ce67: Accept a `${{ }}` interpolation in an agent step's `thinking` field. The schema
  still offers the per-harness enum for editor completion, and the dispatcher
  checks the resolved value against the harness levels. An unsupported
  resolved level fails the step.

### Patch Changes

- 28daafe: Validate literal agent model and provider values during workflow authoring.
- Updated dependencies [ee2ce67]
- Updated dependencies [f78740d]
- Updated dependencies [28daafe]
- Updated dependencies [f13e8bb]
  - @shipfox/api-agent-dto@12.0.0
  - @shipfox/inter-module@0.2.3
  - @shipfox/node-fastify@0.4.1
  - @shipfox/node-module@1.0.5
  - @shipfox/redact@0.2.6
  - @shipfox/node-postgres@0.5.0
  - @shipfox/api-auth-context@12.0.0
  - @shipfox/api-secrets-dto@12.0.0
  - @shipfox/node-drizzle@0.3.5

## 11.0.0

### Patch Changes

- Updated dependencies [25158c8]
  - @shipfox/api-auth-context@11.0.0

## 10.2.0

### Patch Changes

- @shipfox/api-auth-context@10.2.0

## 10.1.0

### Patch Changes

- @shipfox/api-auth-context@10.1.0

## 10.0.0

### Patch Changes

- 43ce975: Align Pi harness compatibility and provider catalog metadata with the current Pi SDK.
- Updated dependencies [74f9e31]
- Updated dependencies [43ce975]
  - @shipfox/node-fastify@0.4.0
  - @shipfox/api-agent-dto@10.0.0
  - @shipfox/api-auth-context@10.0.0
  - @shipfox/node-module@1.0.4
  - @shipfox/api-secrets-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.2
  - @shipfox/redact@0.2.5
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-egress-guard@0.1.3
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/node-postgres@0.4.4

## 9.3.0

### Patch Changes

- Updated dependencies [4425c6d]
  - @shipfox/node-opentelemetry@0.6.3
  - @shipfox/api-auth-context@9.3.0
  - @shipfox/node-fastify@0.3.4
  - @shipfox/node-module@1.0.3

## 9.2.0

### Patch Changes

- @shipfox/api-auth-context@9.2.0

## 9.0.3

### Patch Changes

- Updated dependencies [a831b32]
  - @shipfox/node-error-monitoring@0.3.0
  - @shipfox/node-fastify@0.3.3
  - @shipfox/node-module@1.0.2
  - @shipfox/api-auth-context@9.0.3

## 9.0.2

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.
- Updated dependencies [4b85404]
  - @shipfox/api-agent-dto@9.0.2
  - @shipfox/api-auth-context@9.0.2
  - @shipfox/api-secrets-dto@9.0.2
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.2
  - @shipfox/node-drizzle@0.3.4
  - @shipfox/node-egress-guard@0.1.3
  - @shipfox/node-error-monitoring@0.2.2
  - @shipfox/node-fastify@0.3.2
  - @shipfox/node-module@1.0.1
  - @shipfox/node-opentelemetry@0.6.2
  - @shipfox/node-postgres@0.4.4
  - @shipfox/redact@0.2.5

## 9.0.1

### Patch Changes

- 067d309: Prefixes Agent database objects in the migration baseline.
- 475ce59: Republishes all public packages after restoring release authorization.
- Updated dependencies [8436596]
- Updated dependencies [475ce59]
- Updated dependencies [154e03f]
  - @shipfox/api-secrets-dto@9.0.1
  - @shipfox/redact@0.2.4
  - @shipfox/api-agent-dto@9.0.1
  - @shipfox/api-auth-context@9.0.1
  - @shipfox/config@1.2.3
  - @shipfox/inter-module@0.2.1
  - @shipfox/node-drizzle@0.3.3
  - @shipfox/node-egress-guard@0.1.2
  - @shipfox/node-error-monitoring@0.2.1
  - @shipfox/node-fastify@0.3.1
  - @shipfox/node-module@1.0.0
  - @shipfox/node-opentelemetry@0.6.1
  - @shipfox/node-postgres@0.4.3

## 9.0.0

### Minor Changes

- 46aa52f: Closes remaining API package-boundary exceptions and moves model-provider policy behind the Agent implementation boundary.

### Patch Changes

- Updated dependencies [46aa52f]
- Updated dependencies [02974d6]
  - @shipfox/api-agent-dto@9.0.0
  - @shipfox/api-secrets-dto@9.0.0
  - @shipfox/api-auth-context@9.0.0
  - @shipfox/config@1.2.2
  - @shipfox/inter-module@0.2.0
  - @shipfox/redact@0.2.3
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/node-egress-guard@0.1.1
  - @shipfox/node-error-monitoring@0.2.0
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-module@0.5.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/node-postgres@0.4.2

## 8.0.0

### Patch Changes

- de559bb: Moves Agent validation policy behind a versioned inter-module catalog and injects it into Definitions normalization.
- Updated dependencies [de559bb]
  - @shipfox/api-agent-dto@8.0.0

## 7.1.0

### Patch Changes

- ac42c96: Adds boundary-owned reporting for unexpected API runtime failures while preserving expected client and provider outcomes.
- Updated dependencies [ac42c96]
- Updated dependencies [6ce08c0]
  - @shipfox/node-error-monitoring@0.2.0
  - @shipfox/node-fastify@0.3.0
  - @shipfox/node-module@0.5.0
  - @shipfox/node-opentelemetry@0.6.0
  - @shipfox/api-auth-context@7.1.0

## 6.0.0

### Minor Changes

- a42b575: Exposes Secrets through its inter-module contract and migrates Agent, integrations, and Workflows consumers.

### Patch Changes

- 0bb82a4: Adds the Agent and Integrations inter-module APIs, moving Workflows agent configuration, runtime credential resolution, and integration consumers behind producer-owned clients.
- f73da5d: Enforces bounded API context imports and routes inter-module consumers through producer contracts.
- Updated dependencies [0bb82a4]
- Updated dependencies [54ce48b]
- Updated dependencies [c0162b0]
- Updated dependencies [7ac43a4]
- Updated dependencies [a01e917]
- Updated dependencies [a42b575]
- Updated dependencies [8bdc149]
- Updated dependencies [3810996]
- Updated dependencies [b00ed29]
- Updated dependencies [8aa7cd3]
- Updated dependencies [81f9544]
  - @shipfox/api-agent-dto@6.0.0
  - @shipfox/node-module@0.4.0
  - @shipfox/node-drizzle@0.3.2
  - @shipfox/redact@0.2.3
  - @shipfox/api-secrets-dto@6.0.0
  - @shipfox/api-auth-context@6.0.0
  - @shipfox/node-fastify@0.2.4
  - @shipfox/inter-module@0.2.0

## 5.0.0

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- Updated dependencies [bb037af]
  - @shipfox/api-agent-dto@5.0.0
  - @shipfox/api-auth-context@5.0.0
  - @shipfox/api-secrets@5.0.0
  - @shipfox/config@1.2.2
  - @shipfox/node-drizzle@0.3.1
  - @shipfox/node-egress-guard@0.1.1
  - @shipfox/node-fastify@0.2.3
  - @shipfox/node-module@0.3.2
  - @shipfox/node-opentelemetry@0.5.2
  - @shipfox/node-postgres@0.4.2
  - @shipfox/redact@0.2.2

## 4.0.0

### Patch Changes

- Updated dependencies [bbba3b7]
  - @shipfox/node-drizzle@0.3.0
  - @shipfox/api-secrets@4.0.0
  - @shipfox/node-module@0.3.1

## 3.0.0

### Patch Changes

- 7a71e7d: Aligns published dependency ranges with the workspace catalog policy.
- Updated dependencies [3976f8c]
- Updated dependencies [7a71e7d]
  - @shipfox/node-module@0.3.0
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/api-secrets@3.0.0
  - @shipfox/api-agent-dto@3.0.0
  - @shipfox/node-fastify@0.2.2
  - @shipfox/api-auth-context@3.0.0

## 2.0.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.

### Patch Changes

- Updated dependencies [0cd6dd4]
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/node-module@0.2.0
  - @shipfox/api-agent-dto@2.0.0
  - @shipfox/api-auth-context@2.0.0
  - @shipfox/api-secrets@2.0.0
  - @shipfox/node-egress-guard@0.1.0
  - @shipfox/config@1.2.1
  - @shipfox/node-drizzle@0.2.1
  - @shipfox/node-fastify@0.2.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/node-postgres@0.4.1
  - @shipfox/redact@0.2.1

## 0.1.2

### Patch Changes

- @shipfox/api-secrets@0.1.2
- @shipfox/node-module@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [ec75cd5]
- Updated dependencies [68b8d03]
- Updated dependencies [6a1fb54]
  - @shipfox/node-drizzle@0.2.0
  - @shipfox/redact@0.2.0
  - @shipfox/node-postgres@0.4.0
  - @shipfox/api-secrets@0.1.1
  - @shipfox/node-module@0.1.1

## 0.1.0

### Minor Changes

- 0a6318f: Adds backend model provider storage with workspace defaults and Pi catalog registry validation.
- 067a260: Adds workspace model provider settings for configuring, testing, defaulting, and deleting provider credentials.
- 5bcdbf4: Adds harness-native agent tool catalogs with deployment-aware Pi optional tool package config.

### Patch Changes

- 5cdfc69: Adds a reusable custom-model-provider egress guard with instance config for private-network and host-denylist policy.
- b1f57d1: Moves agent model provider credentials onto the shared secrets store while keeping provider config metadata and runtime resolution behavior intact.
- 97162dd: Resolves model provider, model, and thinking defaults at workflow run creation using workspace and instance configuration.
- aca162b: Add workspace model provider management routes: list provider catalog, list workspace provider configs, test-and-save (upsert) a provider configuration, hard-delete a configuration (clearing the workspace default when needed), and set the workspace default provider. Routes carry per-route error translation and never expose stored credentials.
- 82d22e4: Make the workspace-membership gate stateless. `requireWorkspaceAccess` now lives in `@shipfox/api-auth-context` and authorizes a request purely from the verified session-token claims, replacing the `requireMembership` gate in `@shipfox/api-workspaces` that read the workspace row from the database on every workspace-scoped request. Membership and role already travel in the token, so the check needs no database access.

  This removes the per-request database read and severs the runtime dependency on `@shipfox/api-workspaces` from feature modules that only needed the membership gate (integration providers, secrets, projects, agent, runners). Workspace existence and `active`-status enforcement, which no code path currently exercises, moves off the hot path; enforce it at token issuance when workspace suspension is introduced.

- Updated dependencies [067a260]
- Updated dependencies [34ba284]
- Updated dependencies [3b45d86]
- Updated dependencies [5707d6d]
- Updated dependencies [b9c3f32]
- Updated dependencies [a81b68c]
- Updated dependencies [c0a883c]
- Updated dependencies [72ce351]
- Updated dependencies [e47f8da]
- Updated dependencies [de54da2]
- Updated dependencies [7b175f5]
- Updated dependencies [7ca4c65]
- Updated dependencies [5bcdbf4]
- Updated dependencies [ae7a63c]
- Updated dependencies [f92122b]
- Updated dependencies [360d06d]
- Updated dependencies [f8f339a]
- Updated dependencies [857fd73]
- Updated dependencies [aca162b]
- Updated dependencies [75520ff]
- Updated dependencies [f66f606]
- Updated dependencies [e51d464]
- Updated dependencies [d6d4862]
- Updated dependencies [c0a883c]
- Updated dependencies [6077301]
- Updated dependencies [3bea87f]
- Updated dependencies [82d22e4]
- Updated dependencies [6181819]
- Updated dependencies [3ddde91]
- Updated dependencies [282e66a]
- Updated dependencies [9c149d1]
  - @shipfox/api-agent-dto@0.1.0
  - @shipfox/node-fastify@0.2.0
  - @shipfox/api-secrets@0.1.0
  - @shipfox/node-drizzle@0.1.0
  - @shipfox/api-auth-context@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
  - @shipfox/node-postgres@0.3.2
  - @shipfox/node-module@0.1.0
  - @shipfox/redact@0.1.0
  - @shipfox/config@1.2.0
  - @shipfox/node-egress-guard@0.0.0
