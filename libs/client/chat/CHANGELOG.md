# @shipfox/client-chat

## 53.0.0

### Minor Changes

- 2339c1b: A conversation can start workflow runs, with a limit on how many it starts without a person writing.

  - **Start tool:** `start_workflow_run` is now offered to conversations. It starts a root run in the conversation's project for the conversation owner, and its idempotency key is `conversation:<conversationId>:<callItemId>`, so a repeated call returns the same run. The conversation caller context now carries `agentKey`.
  - **Run budget:** `claimConversationRunStart` on the agent inter-module contract spends one of five run starts. A message from a person resets the count. At the limit, the tool returns `run-budget-exhausted` and tells the agent to ask the user. A repeated call doesn't spend the budget again.
  - **Manual trigger:** `fireManualTrigger` and the manual trigger payload take an optional `conversation` with `id`, `agentKey`, and `provider`. The workflows inter-module contract gains `hasRunForIdempotencyKey`.
  - **Run reads:** run list items and the run overview header return `conversation` with `agent_key`, `provider`, and `author_user_id`, and never the conversation id.
  - **Client:** the run list shows `via Shippy`, the run summary shows `Started by <author> via Shippy`, and the chat shows a `Run started` row that never joins a group of reads. The panel copy and suggested prompts say that Shippy can start work.
  - **Shippy prompt:** a conversation pinned before this change says it can't start runs and suggests a new conversation.

- 1a50666: Project agent files now shape conversations, and a project can have custom agents.

  - **Built-in agent:** the `instructions` of `shippy.yaml` append to the pinned system prompt of a new conversation. Its `provider` and `model` apply from the next turn. A running conversation keeps its prompt.
  - **Custom agents:** a conversation can start with `agent_key` set to a custom agent, which uses its own full prompt. The conversation stores the agent file's content hash. A deleted agent leaves its conversations readable and refuses new messages and retries.
  - **API:** `GET /projects/:projectId/agents` lists the built-in agent and the custom agents with any file error. `createAgentModule` takes an optional `definitions` client.
  - **Chat panel:** a picker appears in a new conversation when the project has custom agents. The panel shows an invalid agent file and a deleted agent.

- 3d329a9: Add the Shippy chat panel beside every project page.

  - **Client chat:** a new package. `chatFeature` contributes the project dock: a panel with a transcript, tool rows, a composer with the page the agent sees, history with delete, and every turn state from thinking to a deleted conversation. `Mod+.` opens or closes it.
  - **Client features:** `defaultFeatures()` includes `chatFeature`.
  - **Client logs:** exports `groupActivityReads`, `ActivityReadGroupNode`, `ActionDetails`, and `actionDisplayLabel`.
  - **Client shell:** `useAgentPageContext()` accepts `undefined`, and its context gains `runNumber` and `name`, which only label the page for the reader.
  - **Agent:** `GET /conversations/:conversationId` returns `latest_turn`, with its status, failure code, and model.
  - **Agent DTO:** adds `conversationLatestTurnDtoSchema`, and `latest_turn` on `conversationDetailDtoSchema`.
  - **Client workflows and projects:** the runs, run, job, automations, and project settings pages tell Shippy where the user is.

- f5c364b: Shows each run result in a Shippy conversation as a card, lists the runs that have no result yet, and shows unread replies as a badge on Shippy. A settled run reads `Listening`. A reply is marked read only when its latest message is in view in a focused tab.

### Patch Changes

- 60ff4ba: Animates floating Shippy and adds a first-run greeting. The dock publishes what the agent is doing with `useShippyStatus`, and the launcher reads it with `useCurrentShippyStatus`. Shippy flicks its tail when idle, blinks its cursor and bobs its head while a reply runs, and waves once when a reply is ready. It stays still after a failure, under reduced motion, and in the tab bar. The first floating Shippy in a browser shows a greeting once. The chat dock keeps following a running turn while the panel is closed.
- Updated dependencies [274a5f7]
- Updated dependencies [2062ec8]
- Updated dependencies [4227bda]
- Updated dependencies [7d20d04]
- Updated dependencies [610ab29]
- Updated dependencies [dc2bd62]
- Updated dependencies [3f1363c]
- Updated dependencies [8937e15]
- Updated dependencies [1f218c4]
- Updated dependencies [8b8b37b]
- Updated dependencies [2e404d5]
- Updated dependencies [0288794]
- Updated dependencies [1f60244]
- Updated dependencies [ac1e750]
- Updated dependencies [c25c566]
- Updated dependencies [0461349]
- Updated dependencies [b183992]
- Updated dependencies [68d6cd6]
- Updated dependencies [9d7c039]
- Updated dependencies [851908c]
- Updated dependencies [7d1ae3e]
- Updated dependencies [c10e4c4]
- Updated dependencies [18678ea]
- Updated dependencies [2339c1b]
- Updated dependencies [dd63da9]
- Updated dependencies [2c9838a]
- Updated dependencies [f57e1d1]
- Updated dependencies [8a4f3d8]
- Updated dependencies [dc8065c]
- Updated dependencies [2021ae8]
- Updated dependencies [c481dab]
- Updated dependencies [205afb5]
- Updated dependencies [2c89020]
- Updated dependencies [530d00f]
- Updated dependencies [c2f006c]
- Updated dependencies [2b3aded]
- Updated dependencies [ef7cf4a]
- Updated dependencies [61b5524]
- Updated dependencies [a99c11b]
- Updated dependencies [93b8cac]
- Updated dependencies [0af8bad]
- Updated dependencies [a020cbf]
- Updated dependencies [fc455ac]
- Updated dependencies [1320dac]
- Updated dependencies [853a185]
- Updated dependencies [ecc70c2]
- Updated dependencies [710275f]
- Updated dependencies [e560f69]
- Updated dependencies [7b0fafd]
- Updated dependencies [900a25a]
- Updated dependencies [988b5f9]
- Updated dependencies [0160be6]
- Updated dependencies [3869c1d]
- Updated dependencies [1a50666]
- Updated dependencies [f43cafb]
- Updated dependencies [32a2dcc]
- Updated dependencies [3fe51c3]
- Updated dependencies [a15e118]
- Updated dependencies [4aad893]
- Updated dependencies [6faa1d7]
- Updated dependencies [507915a]
- Updated dependencies [a328042]
- Updated dependencies [25fd5a8]
- Updated dependencies [97f6dab]
- Updated dependencies [33a6cf9]
- Updated dependencies [710275f]
- Updated dependencies [a429987]
- Updated dependencies [bea7e50]
- Updated dependencies [7056182]
- Updated dependencies [60ff4ba]
- Updated dependencies [3d329a9]
- Updated dependencies [cc70c3b]
- Updated dependencies [f5c364b]
- Updated dependencies [3f1363c]
- Updated dependencies [8317a3c]
- Updated dependencies [2100749]
- Updated dependencies [d0c49b5]
- Updated dependencies [d2a2168]
- Updated dependencies [dd20040]
- Updated dependencies [c3768b2]
- Updated dependencies [405e69e]
- Updated dependencies [70e6983]
  - @shipfox/client-workflows@53.0.0
  - @shipfox/api-agent-dto@34.0.0
  - @shipfox/client-shell@53.0.0
  - @shipfox/client-projects@53.0.0
  - @shipfox/react-ui@3.4.0
  - @shipfox/client-logs@53.0.0
  - @shipfox/client-api@53.0.0
  - @shipfox/client-agent@53.0.0
  - @shipfox/policy-notice@0.1.0
  - @shipfox/client-ui@53.0.0
