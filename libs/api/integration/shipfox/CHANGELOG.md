# @shipfox/api-integration-shipfox

## 34.0.0

### Minor Changes

- 2062ec8: An agent in a Slack or Linear conversation starts workflow runs. `fireManualTrigger` accepts a conversation with a provider and no user as an agent actor, and `start_workflow_run` no longer needs a Shipfox user for such a conversation. The run budget still applies. The run page reads "Started by Shippy in Slack", and Linear shows the run link on the agent session. Web conversations still record their author.
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

- 7cc3735: Adds a `conversation` caller to `integrations.callTool`, so a server-side agent turn can call tools with no job lease.

  - **Breaking:** `AgentToolsCallerContext` and `IntegrationToolCallCaller` become unions. Code that reads `runId`, `jobExecutionId`, or `stepId` from a caller must narrow on the caller kind first.
  - **Provider contract:** `AgentToolsProvider` gains an optional `conversationCatalog`. A provider without one offers a conversation nothing.
  - **Inter-module contract:** `listConversationTools` returns the tools to offer, and `callTool` refuses any other tool for a conversation caller.
  - **Project scoping:** on the `shipfox` provider, a conversation caller can't pass `project_id`, can't call `list_projects`, gets `not-found` for a run or step in another project, and sees a null `parent_run` when the parent is in another project. Lease callers are unchanged.
  - **Audit:** tool call records name the conversation caller with its project, conversation, turn, and call item. The `integrations_agent_tool_call` metric adds a `conversation` value to its `caller` label only.

- b9a53b2: Adds `status_reason`, `status_reason_message`, and `outputs` to the run overview attempt. The `shipfox` provider's `get_workflow_run` tool returns them on its attempt, and the agent-access `get_workflow_run` tool returns them on the run.
- ac3561b: Names what is missing in MCP tool errors when a run cannot start. `fire_manual_trigger` and `create_dev_run` include the variable key and where it is read, the trigger secret key, runner labels and size figures in the error message and details. `start_workflow_run` does the same. The `interpolation-unresolvable` error from Triggers now carries the optional `variableKey`, `jobKey` and `step`.
- 3fe51c3: Events and runs stay inside their project's access.

  - **Events:** the integration event envelope has an optional `resource`. GitHub and Gitea fill it with the repository of the event.
  - **Triggers:** a workflow or listening job in a project whose access excludes the connection or the repository no longer receives the event. The trigger history records the decision as `filtered`, with the reason `project-access`, or `project-deleted` when the project is gone. Dev runs that replay an event apply the same check. The job-activated event and listener subscriptions now carry the project.
  - **Agent:** a request or message for a project that excludes the connection is dropped with `project-access` or `project-deleted`, and no other project answers it.
  - **Shipfox tools:** `start_workflow_run` no longer takes `project_id` and starts runs only in the caller's project.

- a436d9c: The `shipfox` provider gains six read tools, so a conversation or an agent step can troubleshoot a run.

  - **New tools:** `list_workflow_run_jobs`, `get_workflow_job`, `list_workflow_step_attempts`, `list_workflow_run_job_explanations`, `get_workflow_definition_source`, and `search_docs`. `get_workflow_job` returns the job outputs, such as `pr_url`.
  - **`@shipfox/api-integration-shipfox`:** `createShipfoxAgentToolsProvider` takes a required `docs` cache. A conversation caller can't read a run, job, step, or definition from another project.
  - **`@shipfox/api-integration-core`:** the inter-module clients for providers include the docs cache.
  - **`@shipfox/actions`:** the generated tool types include the new tools.
  - **`@shipfox/api-agent`:** adds `createReadSkillTool`, an Agent-local `read_skill` tool that reads shipped skills.

- 2ab4025: Workflows can link to their runs. `run.url` in the run context, `event.run.url` on Shipfox run and job events, and `url` on the `start_workflow_run` output hold the run permalink, built from `CLIENT_BASE_URL`. Replaying a Shipfox event stored without `run.url` fills it in. The `slack-dispatcher` and `report-failed-runs` templates use these links instead of `https://app.shipfox.io/runs/`.

### Patch Changes

- eca4c27: Stops runs that check out the project's source while its connection is missing, disabled, or in error. Trigger starts and listening-job deliveries now fail with the `source-connection-unavailable` known error. Cron records an errored tick and sends no failure alerts, and the next tick after recovery starts a run. A manual fire returns 422.
- ebe3ac1: Adds the Shipfox lifecycle event names, payload schemas, empty event catalog, and exported built-in integration connection ID contract.
- b1cc902: Shipfox read tools now work as `tool:` steps, including `get_step_logs` with `failed_only`.
- Updated dependencies [be33fe6]
- Updated dependencies [af0e24b]
- Updated dependencies [e99aa97]
- Updated dependencies [46f78a0]
- Updated dependencies [2062ec8]
- Updated dependencies [4227bda]
- Updated dependencies [179fa81]
- Updated dependencies [24a18d3]
- Updated dependencies [7d20d04]
- Updated dependencies [610ab29]
- Updated dependencies [dc2bd62]
- Updated dependencies [3f1363c]
- Updated dependencies [8937e15]
- Updated dependencies [1f218c4]
- Updated dependencies [ba1aff7]
- Updated dependencies [2526ccf]
- Updated dependencies [807ae57]
- Updated dependencies [4c789ca]
- Updated dependencies [c4f486b]
- Updated dependencies [7fddfc5]
- Updated dependencies [68d6cd6]
- Updated dependencies [476e3b1]
- Updated dependencies [9d7c039]
- Updated dependencies [eb3f034]
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
- Updated dependencies [8a4f3d8]
- Updated dependencies [b9a53b2]
- Updated dependencies [a9e85c1]
- Updated dependencies [dc8065c]
- Updated dependencies [205afb5]
- Updated dependencies [dcd0b79]
- Updated dependencies [a73e712]
- Updated dependencies [e5872d5]
- Updated dependencies [9e173c3]
- Updated dependencies [530d00f]
- Updated dependencies [f769d90]
- Updated dependencies [15b4274]
- Updated dependencies [593142d]
- Updated dependencies [f1f520f]
- Updated dependencies [ef7cf4a]
- Updated dependencies [f7e0fb7]
- Updated dependencies [61b5524]
- Updated dependencies [8872f36]
- Updated dependencies [9aeb048]
- Updated dependencies [a99c11b]
- Updated dependencies [1872f3d]
- Updated dependencies [0af8bad]
- Updated dependencies [fc455ac]
- Updated dependencies [67e55ea]
- Updated dependencies [ecc70c2]
- Updated dependencies [6b01f3d]
- Updated dependencies [ac3561b]
- Updated dependencies [a436d9c]
- Updated dependencies [af3b91f]
- Updated dependencies [c8e0869]
- Updated dependencies [e560f69]
- Updated dependencies [900a25a]
- Updated dependencies [cdb88a7]
- Updated dependencies [f8adab0]
- Updated dependencies [1d94e37]
- Updated dependencies [10678ba]
- Updated dependencies [3869c1d]
- Updated dependencies [1a50666]
- Updated dependencies [3fe51c3]
- Updated dependencies [a15e118]
- Updated dependencies [4aad893]
- Updated dependencies [6c0d6bd]
- Updated dependencies [eca4c27]
- Updated dependencies [d657853]
- Updated dependencies [c6f2ae3]
- Updated dependencies [fafbe84]
- Updated dependencies [737c625]
- Updated dependencies [d77a8c4]
- Updated dependencies [090d6a0]
- Updated dependencies [507915a]
- Updated dependencies [e6981d5]
- Updated dependencies [25fd5a8]
- Updated dependencies [2c36559]
- Updated dependencies [3aa5d7a]
- Updated dependencies [395e11d]
- Updated dependencies [041ae63]
- Updated dependencies [ebe3ac1]
- Updated dependencies [3d329a9]
- Updated dependencies [f5c364b]
- Updated dependencies [3f1363c]
- Updated dependencies [107ecc7]
- Updated dependencies [27dc317]
- Updated dependencies [94e77bc]
- Updated dependencies [2100749]
- Updated dependencies [9bac67e]
- Updated dependencies [f6bc1f4]
- Updated dependencies [651153a]
- Updated dependencies [d2a2168]
- Updated dependencies [dbe45d5]
- Updated dependencies [e2e561c]
- Updated dependencies [dd20040]
- Updated dependencies [daf0208]
- Updated dependencies [00dd046]
- Updated dependencies [7d9b08a]
- Updated dependencies [82f2480]
- Updated dependencies [ffffc16]
- Updated dependencies [6b2a308]
- Updated dependencies [2ab4025]
- Updated dependencies [0b661c9]
- Updated dependencies [70e6983]
  - @shipfox/api-definitions-dto@34.0.0
  - @shipfox/api-workflows-dto@34.0.0
  - @shipfox/api-secrets-dto@34.0.0
  - @shipfox/api-projects-dto@34.0.0
  - @shipfox/api-triggers-dto@34.0.0
  - @shipfox/api-agent-dto@34.0.0
  - @shipfox/api-integration-spi@5.0.0
  - @shipfox/api-integration-shipfox-dto@34.0.0
  - @shipfox/node-docs-client@0.1.0
  - @shipfox/node-drizzle@0.4.0
  - @shipfox/api-logs-dto@34.0.0
  - @shipfox/annotations-dto@34.0.0

## 33.0.0

### Patch Changes

- @shipfox/api-workflows-dto@33.0.0
- @shipfox/api-triggers-dto@33.0.0

## 32.2.0

### Patch Changes

- @shipfox/api-definitions-dto@32.2.0
- @shipfox/api-workflows-dto@32.2.0
- @shipfox/api-triggers-dto@32.2.0

## 32.1.0

### Patch Changes

- @shipfox/api-workflows-dto@32.1.0
- @shipfox/api-triggers-dto@32.1.0

## 32.0.0

### Patch Changes

- Updated dependencies [212c6b6]
  - @shipfox/api-workflows-dto@32.0.0
  - @shipfox/api-triggers-dto@32.0.0

## 31.0.0

### Minor Changes

- 8db3f51: Adds reference-based secret inputs to `start_workflow_run` for tool steps.

### Patch Changes

- Updated dependencies [9b671f9]
- Updated dependencies [bcd9232]
- Updated dependencies [bab2786]
- Updated dependencies [c5c7fa3]
- Updated dependencies [9e170c7]
- Updated dependencies [bcd9232]
- Updated dependencies [85f3d47]
  - @shipfox/api-triggers-dto@31.0.0
  - @shipfox/api-workflows-dto@31.0.0
  - @shipfox/api-secrets-dto@31.0.0
  - @shipfox/api-definitions-dto@31.0.0
  - @shipfox/api-integration-spi@4.3.3

## 30.0.0

### Patch Changes

- Updated dependencies [0d3c668]
- Updated dependencies [b734fcf]
  - @shipfox/api-integration-spi@4.3.2
  - @shipfox/api-workflows-dto@30.0.0
  - @shipfox/api-triggers-dto@30.0.0
  - @shipfox/api-definitions-dto@30.0.0

## 29.1.0

### Patch Changes

- @shipfox/api-workflows-dto@29.1.0
- @shipfox/api-triggers-dto@29.1.0

## 29.0.0

### Minor Changes

- a859808: Adds the built-in Shipfox workflow tool provider and its `start_workflow_run` tool.
- 8e74f71: Adds read-only Shipfox tools for bounded step logs and paged run annotations.
- 4de2dde: Adds read tools for workspace projects, workflow definitions, and workflow runs.

### Patch Changes

- Updated dependencies [a859808]
- Updated dependencies [e7a8fe4]
- Updated dependencies [f4f1f10]
- Updated dependencies [8e74f71]
  - @shipfox/api-integration-spi@4.3.1
  - @shipfox/api-workflows-dto@29.0.0
  - @shipfox/node-drizzle@0.3.6
  - @shipfox/api-logs-dto@29.0.0
  - @shipfox/annotations-dto@29.0.0
  - @shipfox/api-triggers-dto@29.0.0
  - @shipfox/api-definitions-dto@29.0.0
