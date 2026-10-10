# @shipfox/actions

## 0.1.0

### Minor Changes

- d027d31: Adds the action process runtime. The bootstrap runs an action's handler and reports its outputs and result. The loader resolves the action's packages from the step working directory. `@shipfox/actions/runtime-files` exports the paths of both files.
- 30b30f8: Adds `@shipfox/actions/download-writer`, which writes tool downloads into the job workspace. The runner and the testing helper both use it.

  - **Destination:** `resolveDownloadTarget` resolves a destination against the step working directory and creates the directory. The path must stay inside the workspace, and it is checked again after `realpath` so a symlink cannot lead out. A trailing `/` means a directory.
  - **Name:** `sanitizeDownloadFilename` strips path separators, control characters, and leading dots from the provider's filename.
  - **Write:** `writeDownloadedFile` streams to a hidden `.partial` file while hashing it, enforces the per-file limit and an optional step budget as bytes arrive, and then moves the file into place. In a directory, a taken name gets ` (2)`, ` (3)`, and so on. A file the destination names is replaced. The partial file is removed on any failure.

  The contract adds `MAX_DOWNLOAD_FILE_BYTES` (100 MiB) and `MAX_STEP_DOWNLOAD_BYTES` (1 GiB).

- 1d94e37: Raise the request limit of an action tool call from 2 MiB to 64 MiB, in the actions SDK, the runner endpoint, and the integration tools gateway. An action can now upload the 40 MiB file GitHub accepts in one `create_blob` call. Agent tool calls keep the 2 MiB limit, which the gateway now enforces by step type. The generated tool types include the new GitHub branch and commit tools and the reworked `create_commit`.
- 8798531: Types `ToolResult.structured` from the catalog output schema of the tool when the alias is declared in `Aliases`, and exports `ProviderToolResult`. Tools without an output schema keep an `unknown` result.
- fdff3a6: Adds `@shipfox/actions/testing`, which runs an action from a unit test with fake tools.

  - **`runAction(actionDir, {inputs, tools, workspace, env, timeoutMs})`** checks the inputs against `action.yml`, starts a fake `v1` tool endpoint, and runs the action in its own Node process with the real loader and bootstrap. It returns `status`, `exitCode`, typed `outputs`, `error`, the recorded `calls`, `logs`, `summary`, and the `workspace`.
  - **Grants follow the manifest.** An ungranted tool, or a write tool without `allow_write`, fails with `tool-not-granted`. A granted tool without a fake fails with `no-fake-for-tool`.
  - **`toolResult` and `toolError`** build fake results and errors. Download fakes return bytes, written with the runner's download code.

  The contract adds `inheritedActionEnv`, the runner variables an action inherits. The package now depends on `@shipfox/expression`, `@shipfox/workflow-document`, and `yaml`, used by the testing entry only.

- 5f6f18b: Export the generated tool grants from `@shipfox/actions/tool-grants`, so tooling can list every catalog tool and method with its read or write sensitivity.
- c0d3b0e: Lets `writeDownloadedFile` hand its partial file to a caller-supplied writer. The new `writePartial` option replaces the local `fs` write, so the runner can write downloads through its execution host. Without it, the file is written as before.
- a4e1e24: Adds the workflow actions runtime SDK: `defineAction`, the tools client over the local `v1` runner contract with `ToolResult` and `ToolCallError`, step logging with collapsible groups, and the typed output encoder.
- 1d94e37: A refused provider write now carries a stable reason next to its code: `stale-head`, `branch-not-found`, `branch-exists`, `pull-request-exists`, `no-commits-between`, `protected-branch`, `permission-denied`, or `unprocessable`. `IntegrationProviderError` takes it as `detail`, the tools gateway returns it as `reason`, and an action reads it from `ToolCallError.reason`. `@shipfox/actions` exports `PROVIDER_ERROR_REASONS`, `ProviderErrorReason`, and `ToolCallErrorReason`. The code and the message are unchanged.
- 9f5cf64: Tool arguments are typed from the provider tool catalogs. Declare `Aliases` through module augmentation, for example `declare module '@shipfox/actions' { interface Aliases { slack: 'slack' } }`, and `tools.slack.call` then accepts only Slack tool ids and `family.method` names, with their argument types. `download` accepts only file tools. Results stay `unknown`. Without `Aliases`, calls stay untyped.

### Patch Changes

- 0a77d26: Documents `SHIPFOX_ENV` and `SHIPFOX_PATH` for actions: the runner sets both files, and the values reach the steps that follow, even when the action fails.
- 1153277: Adds the Discord agent tools adapter with the `read_channel` tool.

  - **Tool:** `read_channel` reads messages from a channel or thread in the connected server, newest first, with `limit`, `before`, and `after`. Each message carries a `url`.
  - **Server boundary:** the bot token reaches every server the bot is in, so a channel call first resolves the channel's server and fails unless it is the connection's server. Direct message channels are rejected. The answer is cached for the life of the process.
  - **Errors:** a `403` names the channel and the permission the bot probably lacks. A `429` returns `retryAfterSeconds`. A `401` reports the broken bot token. A session fails with `credentials-unavailable` when the installation is missing or removed.
  - **Catalog:** `@shipfox/api-integration-discord/agent-tools` exports the catalog, and connections created through the core module now advertise the `agent_tools` capability.
  - **Types:** `ProviderToolCatalog` in `@shipfox/actions` lists `discord.read_channel`.

- e6986cb: Adds the `read_thread` and `list_channels` Discord agent tools.

  - **`read_thread`:** reads a thread oldest first. With a thread as `channel_id`, it returns the message the thread started from, then the thread. With a channel and the `message_id` of a message that started a thread, it returns that message then its thread. Otherwise it returns that single message. The same arguments serve a mention at the top level of a channel and inside a thread. `limit` (1 to 100, default 50) caps the thread messages.
  - **`list_channels`:** lists the channels of the connected server, with `name_contains` to filter by name and `include_threads` to add the active threads. Each entry has `id`, `name`, `type`, `parent_id`, and `topic`.
  - **Server boundary:** `read_thread` verifies the channel belongs to the connected server before any read, and `list_channels` takes the server from the connection, never from arguments.
  - **Types:** `ProviderToolCatalog` in `@shipfox/actions` lists `discord.read_thread` and `discord.list_channels`.

- 7d2b854: Adds the `search_messages` and `read_user_profile` Discord agent tools.

  - **`search_messages`:** searches the connected server by `query`, with optional `channel_id` (checked against the server like `read_channel`), `author_id`, `limit` up to 25, and `offset`. Each match carries a `url`. While Discord indexes a new server it answers `202`, which the tool returns as `rate-limited` with `retryAfterSeconds`.
  - **`read_user_profile`:** returns a member's nickname, username, global name, role IDs, and join date. The server always comes from the connection, never from arguments.
  - **Client:** `createDiscordApiClient` gains `searchGuildMessages` and `getGuildMember`.
  - **Types:** `ProviderToolCatalog` in `@shipfox/actions` lists `discord.search_messages` and `discord.read_user_profile`.

- 62f96d4: Adds the Discord `send_message` tool.

  - **Tool:** `send_message` posts a Markdown message to a channel or thread in the connected server, with an optional `reply_to_message_id`. It returns the posted messages, the `id` of the first, and its `url`.
  - **Threads:** `thread_message_id` posts in the thread of that message and creates a public thread named after the message's first 80 characters when there is none. It is ignored when `channel_id` is already a thread.
  - **Long messages:** text over 2,000 characters is split on paragraph, line, then word boundaries into up to 5 messages. Text over 10,000 characters, or that needs more than 5 messages, fails with `content-too-large`.
  - **Mentions:** every message is sent with `allowed_mentions: {parse: ["users"]}`, so it never pings roles or `@everyone`.
  - **Types:** `ProviderToolCatalog` in `@shipfox/actions` lists `discord.send_message`.

- bc9f9c7: Adds the Discord `create_thread`, `update_message`, and `add_reaction` tools.

  - **`create_thread`:** starts a public thread from a message or standalone, and returns its `id`, `channel_id`, and `url`. A message that already has a thread returns that thread. In a forum or media channel, `message` is required and becomes the post.
  - **`update_message`:** replaces the text of a message the bot posted, up to 2,000 characters with no split. Editing another user's message fails with an `access-denied` error.
  - **`add_reaction`:** reacts with a Unicode emoji, or `name:id` for a custom emoji. Shortcodes such as `:thumbsup:` are rejected.
  - **Types:** `ProviderToolCatalog` in `@shipfox/actions` lists `discord.create_thread`, `discord.update_message`, and `discord.add_reaction`.

- 2a1b6eb: Action steps can download Linear uploads with the `download_file` tool.

  - **Tool:** `download_file` is a native `file` tool that takes `{url}`. The URL must start with `https://uploads.linear.app/`, or the tool fails with `file-location-not-allowed`. Signed URLs are accepted. The tool drops the signature and fetches with the connection's token.
  - **Fetch:** every hop passes `@shipfox/node-egress-guard`. The tool follows up to 3 redirects, only to `https` locations, and drops the token once the origin changes. A file that announces more than 100 MiB fails with `file-too-large`.
  - **Configuration:** `LINEAR_UPLOADS_URL` sets the uploads base URL, and `LINEAR_UPLOADS_ALLOW_PRIVATE_NETWORKS` lets a local test server stand in for it. Both default to the production behavior.
  - **Types:** `ProviderToolCatalog` in `@shipfox/actions` lists `linear.download_file` with a `file` result.

- bce8c94: Adds a strict loader mode for registry actions. When the runner sets `SHIPFOX_ACTION_ORIGIN=registry`, a bare import other than `@shipfox/actions*` or a Node built-in fails with `ERR_SHIPFOX_REGISTRY_ACTION_IMPORT`.
- Updated dependencies [6b4ae32]
- Updated dependencies [af3b91f]
- Updated dependencies [d273097]
- Updated dependencies [e087b95]
- Updated dependencies [b76c004]
- Updated dependencies [39c5466]
- Updated dependencies [cfd75e4]
- Updated dependencies [f1f520f]
- Updated dependencies [ab66d1e]
- Updated dependencies [ecc70c2]
- Updated dependencies [e40ec8b]
- Updated dependencies [4e3497b]
- Updated dependencies [d657853]
- Updated dependencies [c6f2ae3]
- Updated dependencies [cb411b1]
- Updated dependencies [9906470]
- Updated dependencies [42829e8]
- Updated dependencies [f6bc1f4]
- Updated dependencies [96ac908]
- Updated dependencies [651153a]
- Updated dependencies [dbe45d5]
- Updated dependencies [0b2af13]
- Updated dependencies [3c8db4c]
- Updated dependencies [e71cded]
- Updated dependencies [2ab4025]
  - @shipfox/workflow-document@3.11.0
  - @shipfox/expression@2.12.0
