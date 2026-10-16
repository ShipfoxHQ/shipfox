# @shipfox/actions

## 0.1.0

### Minor Changes

- d027d31: Adds the action process runtime. The bootstrap runs an action's handler and reports its outputs and result. The loader resolves the action's packages from the step working directory. `@shipfox/actions/runtime-files` exports the paths of both files.
- 9105b6b: Every action gets `ctx.cache` to save files in a job and restore them in a later job of the same project.

  - **SDK:** `cache.hashFiles(patterns)`, `cache.restore(options)`, and `cache.save(options)`. Paths anchor to the step working directory, the home directory, or `/`, so an entry restores into a job with another checkout path or home. Files are archived as zstd-compressed `tar` segments in the action process and moved to object storage in parallel parts and ranges, with retries per part. A miss, a full workspace, or a storage failure logs a warning and resolves. A failure while writing files throws `CacheExtractionError`.
  - **Contract:** the local endpoint serves `/v1/cache/restore`, `/v1/cache/entries`, `/v1/cache/entries/commit`, `/v1/cache/entries/abort`, and `/v1/cache/entries/check`, and the runner sets `SHIPFOX_TEMP`. Both are additive, so the contract stays `v1`.
  - **Testing:** `createCacheFake()` in `@shipfox/actions/testing`, and a `cache` option on `runAction`.

- 30b30f8: Adds `@shipfox/actions/download-writer`, which writes tool downloads into the job workspace. The runner and the testing helper both use it.

  - **Destination:** `resolveDownloadTarget` resolves a destination against the step working directory and creates the directory. The path must stay inside the workspace, and it is checked again after `realpath` so a symlink cannot lead out. A trailing `/` means a directory.
  - **Name:** `sanitizeDownloadFilename` strips path separators, control characters, and leading dots from the provider's filename.
  - **Write:** `writeDownloadedFile` streams to a hidden `.partial` file while hashing it, enforces the per-file limit and an optional step budget as bytes arrive, and then moves the file into place. In a directory, a taken name gets ` (2)`, ` (3)`, and so on. A file the destination names is replaced. The partial file is removed on any failure.

  The contract adds `MAX_DOWNLOAD_FILE_BYTES` (100 MiB) and `MAX_STEP_DOWNLOAD_BYTES` (1 GiB).

- be33fe6: An action can declare a `post` entry in `action.yml`, which Shipfox runs at the end of the job.

  - **Manifest:** `post` follows the path rules of `main` and must differ from it. `post_failure` is `warn` (the default) or `fail`, and needs `post`. A repository action must contain the `post` file.
  - **Workflow model:** an action step carries `post` and `postFailure`. Models stored before this change omit both.
  - **SDK:** `defineAction` handlers receive `state.set(name, value)` and `state.get(name)`, backed by the `SHIPFOX_STATE` file. `context` gains `phase`, and `execution` and `main` for a post. `setOutput` throws in a post.
  - **Testing:** `runAction` accepts `phase`, `state`, `executionFailed`, and `mainStatus`, and returns the `state` after the run.
  - **Registry bumps:** `computeActionBump` returns `minor` when `post` is added or removed, `major` when `post_failure` goes from `warn` to `fail`, and `patch` from `fail` to `warn`.

- c9a7186: Adds `setEnv`, `addPath`, and `addMask` to the action handler context.

  - **`setEnv(name, value)`** sets an environment variable for the later steps of the job. It rejects `PATH` and names starting with `SHIPFOX_`.
  - **`addPath(directory)`** puts a directory at the front of `PATH` for the later steps of the job.
  - **`addMask(value)`** masks a value in the logs, outputs, and annotations of the later steps of the job, through the new `SHIPFOX_MASK` file. A value shorter than 8 characters throws. A multi-line value is masked line by line.

  The helpers write right away, so the values survive a later throw. `runAction` now sets the three files and returns `carriedEnv`, `carriedPath`, and `masks`.

  The contract adds the `env`, `path`, and `mask` names to `ACTION_ENV`, and `MIN_MASKED_VALUE_LENGTH`.

- 1d94e37: Raise the request limit of an action tool call from 2 MiB to 64 MiB, in the actions SDK, the runner endpoint, and the integration tools gateway. An action can now upload the 40 MiB file GitHub accepts in one `create_blob` call. Agent tool calls keep the 2 MiB limit, which the gateway now enforces by step type. The generated tool types include the new GitHub branch and commit tools and the reworked `create_commit`.
- 8798531: Types `ToolResult.structured` from the catalog output schema of the tool when the alias is declared in `Aliases`, and exports `ProviderToolResult`. Tools without an output schema keep an `unknown` result.
- 0b661c9: Adds `@shipfox/actions/hash-files`, so the runner hashes files with the same code as `cache.hashFiles`.

  - **`hashFiles({patterns, directories, limits, signal})`** resolves with `{hash, files}`. `directories` needs `cwd`, and `home` and `root` are optional. A pattern under a missing anchor throws `CacheArgumentError`.
  - **Limits:** with `limits` (`{maxFiles, maxBytes}`), more matched files or more bytes read throws `HashFilesLimitError`, whose `limit` is `files` or `bytes`. `HASH_FILES_RUNNER_LIMITS` is 10,000 files and 1 GiB.
  - **No match** throws `HashFilesNoMatchError`, which extends `CacheArgumentError` and keeps the message.
  - **Separators:** on Windows, matched paths now use `/` before they are sorted and hashed, so a `key_files` or `cache.hashFiles` key that matched a nested file changes once there. Hashes on Linux and macOS are unchanged, and `\` stays a name character.
  - **Hashing process:** `runHashFilesRequest` answers a `{patterns, cwd, limits}` request with `{ok, hash, files}` or a failure the author can fix (`no-match`, `limit`, or `invalid`), and `parseHashFilesResponse` reads the answer. `HASH_FILES_CLI_PATH` from `@shipfox/actions/runtime-files` runs it as a process, so the runner hashes inside a job container.

- fdff3a6: Adds `@shipfox/actions/testing`, which runs an action from a unit test with fake tools.

  - **`runAction(actionDir, {inputs, tools, workspace, env, timeoutMs})`** checks the inputs against `action.yml`, starts a fake `v1` tool endpoint, and runs the action in its own Node process with the real loader and bootstrap. It returns `status`, `exitCode`, typed `outputs`, `error`, the recorded `calls`, `logs`, `summary`, and the `workspace`.
  - **Grants follow the manifest.** An ungranted tool, or a write tool without `allow_write`, fails with `tool-not-granted`. A granted tool without a fake fails with `no-fake-for-tool`.
  - **`toolResult` and `toolError`** build fake results and errors. Download fakes return bytes, written with the runner's download code.

  The contract adds `inheritedActionEnv`, the runner variables an action inherits. The package now depends on `@shipfox/expression`, `@shipfox/workflow-document`, and `yaml`, used by the testing entry only.

- 5f6f18b: Export the generated tool grants from `@shipfox/actions/tool-grants`, so tooling can list every catalog tool and method with its read or write sensitivity.
- b183992: Registers the Claap provider. The integrations module loads it on every start, with no feature flag, and reads the new `CLAAP_MCP_ENDPOINT` setting. The workflow tool catalog now lists the Claap tools, and run logs show the Claap name.
- 23a6b3a: Add the `add_tag`, `remove_tag`, and `set_custom_field` ClickUp tools. A workflow can now record its state on a task in tags, and write a result to a custom field instead of the description. `add_tag` creates the tag in the task's Space when it doesn't exist. The generated action tool types include the new tools.
- c0d3b0e: Lets `writeDownloadedFile` hand its partial file to a caller-supplied writer. The new `writePartial` option replaces the local `fs` write, so the runner can write downloads through its execution host. Without it, the file is written as before.
- 1880cc2: Add the `pull_request_auto_merge` GitHub tool. `enable` makes GitHub merge a pull request once its required reviews and checks pass, with an optional merge method and commit title and message. When GitHub refuses auto-merge because nothing blocks the merge, `enable` merges the pull request right away and returns `pull_request.merged` as true. `enable` also succeeds on a pull request that is already merged, so a retry is safe. `disable` cancels a pending auto-merge and succeeds when none is enabled. `enable` is sensitive, like `merge_pull_request`, and `disable` needs only `pull_requests: write`. The generated tool types include the new tool.

  Errors from GitHub GraphQL tools now carry a reason, as REST errors do. `FORBIDDEN` is `access-denied`, `RATE_LIMITED` is `rate-limited`, and any other refusal is `provider-rejected` with GitHub's messages. Before, only a missing review thread was classified, and other GraphQL errors were rethrown unclassified.

- c434bd0: Add the `update_issue_comment` GitHub tool, which replaces the body of an issue or pull request conversation comment. A workflow can now keep one status comment up to date instead of posting a new one on every run. The tool edits only comments that the Shipfox GitHub app wrote, and refuses any other comment with `access-denied` before it sends the edit. The generated action tool types include the new tool.
- f769d90: Add the `image` tool result kind. A provider marks a tool that returns images with `result: 'image'`. An agent step can call it and receives the image blocks. A tool step that names it fails validation with `integration-tool-agent-only`, and an action cannot call it: the generated action tool types leave it out and the action endpoint refuses the call.
- f769d90: Add the Jam integration. An admin connects a Jam workspace by pasting a personal access token, and agent steps and tool steps can then read a Jam bug report: its details, console logs, network requests, user events, metadata, transcript and chapters, and search Jams. Agent steps can also read screenshots and video frames as images. The connection is read-only, takes a Jam ID or a `jam.dev` link, and can have its token replaced without recreating it. The generated action tool types include the Jam tools.
- a4e1e24: Adds the workflow actions runtime SDK: `defineAction`, the tools client over the local `v1` runner contract with `ToolResult` and `ToolCallError`, step logging with collapsible groups, and the typed output encoder.
- 1d94e37: A refused provider write now carries a stable reason next to its code: `stale-head`, `branch-not-found`, `branch-exists`, `pull-request-exists`, `no-commits-between`, `protected-branch`, `permission-denied`, or `unprocessable`. `IntegrationProviderError` takes it as `detail`, the tools gateway returns it as `reason`, and an action reads it from `ToolCallError.reason`. `@shipfox/actions` exports `PROVIDER_ERROR_REASONS`, `ProviderErrorReason`, and `ToolCallErrorReason`. The code and the message are unchanged.
- 9f5cf64: Tool arguments are typed from the provider tool catalogs. Declare `Aliases` through module augmentation, for example `declare module '@shipfox/actions' { interface Aliases { slack: 'slack' } }`, and `tools.slack.call` then accepts only Slack tool ids and `family.method` names, with their argument types. `download` accepts only file tools. Results stay `unknown`. Without `Aliases`, calls stay untyped.

### Patch Changes

- 0a77d26: Documents `SHIPFOX_ENV` and `SHIPFOX_PATH` for actions: the runner sets both files, and the values reach the steps that follow, even when the action fails.
- f87aa78: When an action fails and also leaves an invalid `SHIPFOX_ENV` or `SHIPFOX_PATH` file, the step log now has a line naming the rejected file. The original failure stays the step result.
- 0461349: `get_recording` and `get_recording_transcript` now declare in their input schema that a call needs `recordingId` or `recordingUrl`, so a tool step without either fails validation before it reaches Claap.
- 476e3b1: An `action.yml` can set `steps` instead of `main` to declare a composite action. Sync expands it into the definition model.

  - **Breaking:** `ActionManifest` is now a union of a JavaScript and a composite manifest, so `main` can be `undefined`. Narrow it with `isCompositeActionManifest`. `actionManifestSchema` is a transform, so it no longer exposes `.shape` or `.extend`.
  - **Manifest:** a composite manifest sets `steps` instead of `main`, and has no `runtime`, `post`, or `post_failure`. Its outputs need `value`, and its inputs can set `secret: true`. Inner steps reject `checkout` and `export`, and a tool step needs `connection`. `uses:` and prompt `file:` accept a leading `${{ action.path }}/`. `safeParseActionManifest` rejects composite manifests unless `compositeActions` is set.
  - **Expressions:** `action` is a reserved root, readable only inside a composite action. `buildCompositeScopeEnvironment` types its inner `inputs` and `action`, and `action.outputs` is the field for an output `value`.
  - **Resolution:** composite actions are resolved recursively, at most 5 levels deep. A cycle fails with the new `action-cycle` sync error code, and deeper nesting with `action-nesting-too-deep`. The 20-action limit counts the whole tree, and the content hash covers every action and prompt file in it.
  - **Workflow model:** a `composite` step holds its inner steps, with path ids, scoped `inputs` and `steps`, secret inputs rewritten to the caller's references, and aliases bound to the caller's connections. A nested grant must fit inside its outer alias. Source locations can name the composite file. Snapshots with a composite step use version 6, and `flattenJobSteps` lists a job's steps in run order.

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

- 8a51054: `pull_request_read.get_review_threads` now returns `isOutdated` on each thread, and `originalLine` and `originalStartLine` on each thread and comment. GitHub sets `line` and `startLine` to null once a later push changes the code under a thread, so the original fields keep an outdated thread's position. The ticket-to-pr feedback loop now passes each review comment's `original_line` and tells the agent to check an outdated thread against the current code before applying it.
- 2a1b6eb: Action steps can download Linear uploads with the `download_file` tool.

  - **Tool:** `download_file` is a native `file` tool that takes `{url}`. The URL must start with `https://uploads.linear.app/`, or the tool fails with `file-location-not-allowed`. Signed URLs are accepted. The tool drops the signature and fetches with the connection's token.
  - **Fetch:** every hop passes `@shipfox/node-egress-guard`. The tool follows up to 3 redirects, only to `https` locations, and drops the token once the origin changes. A file that announces more than 100 MiB fails with `file-too-large`.
  - **Configuration:** `LINEAR_UPLOADS_URL` sets the uploads base URL, and `LINEAR_UPLOADS_ALLOW_PRIVATE_NETWORKS` lets a local test server stand in for it. Both default to the production behavior.
  - **Types:** `ProviderToolCatalog` in `@shipfox/actions` lists `linear.download_file` with a `file` result.

- bce8c94: Adds a strict loader mode for registry actions. When the runner sets `SHIPFOX_ACTION_ORIGIN=registry`, a bare import other than `@shipfox/actions*` or a Node built-in fails with `ERR_SHIPFOX_REGISTRY_ACTION_IMPORT`.
- Updated dependencies [be33fe6]
- Updated dependencies [6b4ae32]
- Updated dependencies [af3b91f]
- Updated dependencies [7d20d04]
- Updated dependencies [3f1363c]
- Updated dependencies [8937e15]
- Updated dependencies [d273097]
- Updated dependencies [e087b95]
- Updated dependencies [476e3b1]
- Updated dependencies [9d7c039]
- Updated dependencies [c0b814f]
- Updated dependencies [0654280]
- Updated dependencies [3b63397]
- Updated dependencies [b76c004]
- Updated dependencies [0b661c9]
- Updated dependencies [39c5466]
- Updated dependencies [cfd75e4]
- Updated dependencies [f1f520f]
- Updated dependencies [cfe6ce6]
- Updated dependencies [ab66d1e]
- Updated dependencies [67e55ea]
- Updated dependencies [ecc70c2]
- Updated dependencies [e40ec8b]
- Updated dependencies [e08530c]
- Updated dependencies [4e3497b]
- Updated dependencies [d657853]
- Updated dependencies [c6f2ae3]
- Updated dependencies [cb411b1]
- Updated dependencies [9906470]
- Updated dependencies [42829e8]
- Updated dependencies [2100749]
- Updated dependencies [f6bc1f4]
- Updated dependencies [96ac908]
- Updated dependencies [651153a]
- Updated dependencies [dbe45d5]
- Updated dependencies [0b2af13]
- Updated dependencies [3c8db4c]
- Updated dependencies [0b661c9]
- Updated dependencies [e71cded]
- Updated dependencies [2ab4025]
  - @shipfox/workflow-document@4.0.0
  - @shipfox/expression@2.12.0
