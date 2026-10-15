# Shipfox Actions

The runtime SDK for Shipfox workflow actions: JavaScript and TypeScript code that a workflow step
runs with `uses: ./path`, calling Shipfox integration tools through the runner.

## What it does

- **`defineAction(handler)`** declares an action. The entry file default-exports the result. The
  handler receives `inputs`, `tools`, `cache`, `setOutput`, `setEnv`, `addPath`, `addMask`,
  `state`, `log`, `signal`, and `context`, and may return an object of outputs.
- **`setEnv(name, value)`** and **`addPath(directory)`** hand an environment variable or a `PATH`
  directory to the later steps of the job. **`addMask(value)`** masks a value in those steps.
- **`state.set(name, value)` and `state.get(name)`** pass string values from the `main` entry to
  the `post` entry of the same step. See [Post entry](#post-entry).
- **`tools.<alias>.call(tool, args, {signal})`** calls a tool granted to a manifest alias and
  returns a `ToolResult`. `tool` is a tool id or `family.method`.
- **`tools.<alias>.download(tool, args, {destination})`** calls a file tool. The runner writes the
  file into the workspace and returns a `DownloadedFile` with `path`, `bytes`, `sha256`,
  `mediaType`, and `filename`.
- **`cache.hashFiles(patterns)`, `cache.restore(options)`, and `cache.save(options)`** keep files
  between jobs of the same project. See [Cache](#cache).
- **`Aliases`** maps manifest aliases to provider slugs through module augmentation. Tool names,
  arguments, and structured results are then typed from the provider catalogs. Without it, any
  tool name and `Record<string, unknown>` arguments are accepted, and results are `unknown`.
- **`ToolResult`** holds `structured` (or `null`) and the raw `content` blocks. `structured` is
  typed when the alias is declared and the tool's catalog has an output schema, and `unknown`
  otherwise. `ProviderToolResult<Provider, Tool>` names that type. `text()` joins
  the text blocks. `json()` parses that text and throws when it is not JSON. Text is never parsed
  silently.
- **`ToolCallError`** is thrown for a failed call, with `code`, `reason`, `retryAfterSeconds`,
  `outcomeUnknown`, and `callId`. When a provider refuses a write, `reason` may be a
  `ProviderErrorReason` such as `stale-head` or `pull-request-exists`, listed in
  `PROVIDER_ERROR_REASONS`. When it is set, branch on it instead of matching the message. A
  refusal the provider cannot name has no reason. When `outcomeUnknown` is true, a write may
  have reached the provider, so do not retry it blindly.
- **`ActionOutputError`** is thrown when an output is undeclared, has the wrong type, or a
  required output is missing.
- **`log.info`, `log.warn`, `log.error`, and `log.group(name, fn)`** write to the step log.
  `group` prints collapsible `::group::` and `::endgroup::` markers.
- **`@shipfox/actions/runtime-files`** exports `ACTION_BOOTSTRAP_PATH` and `ACTION_LOADER_PATH`,
  the built action process runtime. The runner and the testing helper start every action as
  `node --import <loader> <bootstrap>`, with the step working directory as `cwd` and the `v1`
  environment variables set. Run these files; do not import them.
- **`@shipfox/actions/contract`** exports the `v1` local contract between the action process and
  the runner: routes, request and response shapes, limits, and environment variable names.
- **`@shipfox/actions/download-writer`** writes tool downloads into the job workspace. The runner
  and the testing helper use it, so tests write files the way runs do. Actions do not import it.
- **`@shipfox/actions/hash-files`** exports `hashFiles`, the function behind `cache.hashFiles`,
  for the runner. `hashFiles({patterns, directories, limits, signal})` resolves with `{hash, files}`.
  `directories` needs `cwd`, and `home` and `root` are optional. A pattern under a missing anchor
  throws `CacheArgumentError`. With `limits` (`{maxFiles, maxBytes}`), more matched files or more
  bytes read throws `HashFilesLimitError`, whose `limit` is `files` or `bytes`. No match throws
  `HashFilesNoMatchError`, a `CacheArgumentError`. `HASH_FILES_RUNNER_LIMITS` is the runner's
  10,000 files and 1 GiB. Actions use `cache.hashFiles` instead.
- **`@shipfox/actions/tool-grants`** exports `toolGrants`, the generated list of every catalog
  tool by provider slug and tool id, and the `ToolGrant` type. A grant has `sensitivity` (`read` or
  `write`), `result` (`json` or `file`), and, for a family tool, `methods` with the sensitivity of
  each method.
- **`@shipfox/actions/testing`** runs an action from a unit test with fake tools and a fake cache.
  It exports `runAction`, `toolResult`, `toolError`, and `createCacheFake`. See [Testing an action](#testing-an-action).
- **`CacheArgumentError`** is thrown for `paths`, a key, or a scope that can never work.
  **`CacheExtractionError`** is thrown when a restore fails while writing files.
- **`ActionStateError`** is thrown when a state name is not an identifier, a value is not a string,
  the state file would pass 256 KiB, or the runner provided no state file.

## Installation and setup

The runner supplies this package to every action, so an action runs without installing it. Add
it as a development dependency for editor types:

```bash
pnpm add -D @shipfox/actions
```

## Usage

```ts
import {defineAction} from '@shipfox/actions';

export default defineAction(async ({inputs, tools, log, signal}) => {
  const page = await tools.slack.call(
    'read_thread',
    {channel_id: inputs.channel_id, message_ts: inputs.thread_ts},
    {signal},
  );
  const {messages} = page.structured as {messages: unknown[]};
  log.info(`Collected ${messages.length} messages`);
  return {message_count: messages.length};
});
```

Slack tools declare no output schema, so this result is `unknown` and the action casts it.

To type tool arguments and results, declare every alias of the manifest once, for example in the
entry file:

```ts
declare module '@shipfox/actions' {
  interface Aliases {
    slack: 'slack';
  }
}
```

## Cache

`ctx.cache` saves files from a job and restores them in a later job of the same project. All file
work runs in the action process, which is inside the container for a container job. The archive
goes straight to object storage through signed URLs, not through the runner or the API.

```ts
export default defineAction(async ({cache}) => {
  const key = `tools-${await cache.hashFiles(['tools.lock'])}`;
  const restored = await cache.restore({paths: ['.tools', '~/.cache/tools'], key, restoreKeys: ['tools-']});
  if (!restored.hit) {
    await installTools();
    await cache.save({paths: ['.tools', '~/.cache/tools'], key});
  }
});
```

- **`hashFiles(patterns)`** expands the glob patterns, sorts the matched files, and hashes each
  path and its content with SHA-256. It returns the first 32 hex characters. Paths use `/` on every
  platform, so a Windows match hashes like the same file on Linux. It throws `CacheArgumentError`
  when nothing matches, so a missing lock file cannot give every run the same key.
- **`restore({paths, key, restoreKeys, scope, fallbackScopes})`** resolves with `hit`, which is true
  when an entry with exactly `key` was restored, and with `matchedKey` and `matchedScope` when
  anything was restored. A prefix match restores the files and reports `hit: false`, so the action
  saves under the exact key afterwards. `scope` defaults to `default`.
- **`save({paths, key, scope})`** resolves with `saved`, and with a `reason` when it is false:
  `exists`, `in-progress`, `no-match`, `too-large`, `cancelled`, or `failed`. The first save of a key
  wins. A repeated save checks first and costs one request.
- **Paths** are anchored by how they are written. `node_modules` is relative to the step working
  directory, `~/.npm` to the home directory, and `/opt/tools` is absolute. Entries hold names
  relative to their anchor, so an entry saved from one checkout path and home directory restores
  into another. A relative path that leaves the working directory through `..` throws
  `CacheArgumentError`. Glob characters (`* ? [ ] { }` and the `!(` `@(` `+(` openers) always mean a pattern, and a
  matched name with a line break fails the save.
- **The version** hashes `paths` as written, the platform, the architecture, and the archive
  format, so a restore with other paths or on another architecture is a miss.
- **Best effort.** `restore` and `save` do not throw on a miss, a full workspace, or a storage
  failure. They log a warning and resolve. Everything before extraction is a miss: the SDK
  downloads and checks the size and SHA-256 of the whole archive before it writes outside the
  job temp directory. Extraction merges into existing directories and cannot roll back, so a
  failure there throws `CacheExtractionError`, which names the directory.
- **Await every call.** The handler's `signal` stops transfers and `tar`, and a save that was
  cancelled or failed tells the API to drop its reservation.
- **Requirements.** The image needs `tar`. Archives live in `SHIPFOX_TEMP`, a directory the runner
  creates for the step, or in the system temporary directory without it. Save and restore each
  need free disk there equal to the archive. An absolute path that passes through a
  symlinked directory, such as `/tmp` on macOS, cannot be restored by BSD `tar`. Name the real path.

### Archive format

Format `segments-1` is one line of JSON padded to 4096 bytes, then one zstd-compressed `tar`
per anchor in use:

```text
{"format":"segments-1","segments":[{"anchor":"cwd","bytes":123},{"anchor":"home","bytes":456}]}
<zstd(tar of cwd members)><zstd(tar of home members)>
```

Each anchor is one `tar -c -f - -C <anchor directory> -T <member list>` call, and restore runs
`tar -x -f - -C <anchor directory>`. No archive holds an absolute path, and `tar -P` is never used.
Symlinks inside a saved directory are stored as symlinks. GNU, BSD, and BusyBox `tar` all work.

### Transfers

- A save checks the key, archives to a temp file, reserves the entry with the size and hash, uploads
  32 MiB parts eight at a time, and commits.
- A restore downloads 32 MiB ranges eight at a time into a temp file of the final size, checks it, and
  extracts each segment.
- A part or range is tried up to 4 times, waiting about 0.5 s, 2 s, and 8 s plus jitter, on a
  network error, a stall of 30 s without bytes, 408, 429, and 5xx. Only that part is sent again.
  A 403 or 404 is not retried, and a 404 on a download is a miss at once. A part that runs out of
  attempts stops the transfer.
- A control call to the runner is tried up to 3 times on a network error, 429, and 5xx.
- Signed URLs are not refreshed. They last one hour.

## Post entry

An action can declare a second entry in `action.yml` that runs at the end of the job:

```yaml
main: index.ts
post: post.ts
post_failure: warn # or `fail`; the default is `warn`
```

`post` follows the path rules of `main` and must differ from it. `post_failure` needs `post`. With
`fail`, a failed post fails the job. Each entry default-exports its own `defineAction` handler and
runs in a fresh process, so `state` is the only channel between them:

```ts
// index.ts
export default defineAction(({state}) => {
  state.set('cache_key', 'abc');
});

// post.ts
export default defineAction(({state, context}) => {
  if (context.execution?.failed) return;
  const key = state.get('cache_key'); // 'abc', or undefined when main never set it
});
```

- **`state.set(name, value)`** takes an identifier and a string, and appends one JSON line to the
  file named by `SHIPFOX_STATE`. **`state.get(name)`** reads the values the file held at start,
  then the values set in this process. The file holds up to 256 KiB.
- **`context.phase`** is `main` or `post`. In a post, `context.execution.failed` tells whether the
  job has failed and `context.main.status` tells how the main entry ended. Both are absent in
  `main`.
- **A post has no outputs.** `setOutput` throws in a post, and a post that returns outputs fails.
- **State stays on the runner**, in a file any step of the job can read. It is not a secret store.

Shipfox runs one post for each step that uses an action declaring `post`. The posts run after
all the authored steps of the job have finished, in reverse step order. A post is skipped only when
its main entry never reached the runner, for example because an `if` or an earlier failure skipped
the step. A post does not run after a cancellation, a timeout, or a lost runner. With a gate
`restart_from`, the post receives the inputs, secrets, state, and exported environment of the last
attempt that ran, even when a restart later skipped the step. State stays in the memory of the
runner that ran the main entry.

## Testing an action

`runAction(actionDir, {inputs, tools, cache, workspace, env, phase, state, timeoutMs})` runs the action in its own
Node process, started the way a runner starts it, with the real loader and bootstrap. It works
under any test runner, including Vitest's `threads` and `forks` pools, Jest, and `node:test`.

```ts
import {runAction, toolResult} from '@shipfox/actions/testing';
import {expect, test} from 'vitest';

test('collects every page of a thread', async () => {
  const result = await runAction(new URL('./', import.meta.url), {
    inputs: {channel_id: 'C1', thread_ts: '1.0'},
    tools: {
      slack: {
        read_thread: (args) =>
          toolResult(
            args.cursor
              ? {messages: [{ts: '1.2', text: 'second'}]}
              : {messages: [{ts: '1.1', text: 'first'}], response_metadata: {next_cursor: 'c2'}},
          ),
      },
    },
  });

  expect(result.status).toBe('succeeded');
  expect(result.outputs.message_count).toBe(2);
  expect(result.calls.map((call) => call.args.cursor)).toEqual([undefined, 'c2']);
  expect(await result.workspace.read('context/slack-thread.md')).toContain('second');
});
```

- **Inputs** are checked against `action.yml` with defaults applied, as at dispatch. An invalid
  manifest or input rejects with `ActionTestSetupError` before the action starts.
- **Fakes** are functions keyed by alias, then by the tool name the action calls (`tool` or
  `family.method`). A `call` fake returns `toolResult(structured)` or a plain value. A `download`
  fake returns the file bytes, or `{bytes, filename, mediaType}`, and the file is written with
  the runner's download code. Throw `toolError('rate-limited')` or
  `toolError({outcomeUnknown: true})` to test error paths.
- **Grants follow the manifest.** A call to an undeclared alias or an ungranted tool, or a write
  tool without `allow_write`, fails with `tool-not-granted`. A granted tool without a fake fails
  with `no-fake-for-tool`. A fake that throws anything else, such as a failed assertion, makes
  `runAction` reject with that error.
- **The result** holds `status`, `exitCode`, `outputs` (typed as later steps see them), `state`,
  `error`, every `calls` entry, the interleaved `logs`, the `summary`, the `carriedEnv`,
  `carriedPath`, and `masks` the action wrote for later steps, and the `workspace`.
- **Phases.** `phase: 'post'` runs the `post` entry. `state` seeds the state file, and
  `result.state` returns it after the run, so a test passes the state of the main run to the post
  run. `executionFailed` and `mainStatus` set `context.execution.failed` and `context.main.status`
  for the post.
- **The cache** is an empty fake unless `cache` names one. `createCacheFake({partSizeBytes})` keeps
  the index in memory and the archives in a temporary directory, and serves the signed URLs from
  the same local endpoint, so `ctx.cache` runs its real code. Pass one fake to several `runAction`
  calls to save in one and restore in another, each with its own `workspace` and its own `HOME` in
  `env`. `fake.entries` lists what was saved, and `fake.dispose()` removes the archives.
- **The workspace** is a new temporary directory unless `workspace` names one. Call
  `result.workspace.remove()` to delete it. It deletes a named workspace too, so name only a
  disposable directory.
- **`timeoutMs`** defaults to 30 seconds. The process group is killed when it passes.

Limits:

- Module mocks such as `vi.mock` do not reach the action's process. Fakes run in the test
  process, so they can hold state and assert on arguments.
- Coverage of action files needs a tool that follows child processes, such as `c8`.
- Packages resolve with the real loader, so the test workspace needs the action's packages
  installed, as a run does.

## Behavior notes

- **Outputs follow their declared type.** A `json` output is always written with
  `JSON.stringify`, strings included, so the string `"true"` stays a string. `string`,
  `number`, and `boolean` outputs must hold that type. A top-level `undefined`, `NaN`, cycles, and
  `BigInt` are rejected. Nested `undefined` follows `JSON.stringify`.
- **`setOutput` writes right away**, so the value survives a later throw. The returned object is
  merged over earlier `setOutput` values. A declaration without `required: false` is required.
- **Only `rate-limited` errors are retried**, up to 3 times and within 60 seconds in total,
  waiting `retry_after_seconds` when the runner sends it. No other error is retried.
- **A request above 64 MiB fails with `request-too-large`** before any network call. The limit
  fits the 40 MiB file GitHub accepts in one `create_blob` after base64.
- **Argument types are generated** from the provider catalogs into `src/generated/tool-catalog.ts`.
  Regenerate them with `pnpm --filter @shipfox/action-tool-types generate`.
- **Downloads** resolve `destination` against the step working directory and must stay inside
  the job workspace, symlinks included. A trailing `/` means a directory: the file keeps the
  provider's name, made safe, or `download-<call id>`, and a taken name gets ` (2)`, ` (3)`, and
  so on. A destination without a trailing `/` names the file and replaces it. A file is limited
  to 100 MiB, all downloads of a step to 1 GiB, and each download to 290 seconds. A failed
  download leaves no file behind.
- **Cancellation** through `signal` throws `ToolCallError` with code `cancelled`. It sets
  `outcomeUnknown` when the request was already sent.

## Action process

The bootstrap:

- raises its own `/proc/self/oom_score_adj` to 1000, so the kernel OOM killer picks the action
  over the runner;
- removes `SHIPFOX_ACTIONS_TOKEN` and `SHIPFOX_ACTION_INPUTS` from `process.env` before it loads
  the action, so processes the action spawns do not inherit endpoint access;
- imports `SHIPFOX_ACTION_MAIN` and fails with the expected shape when its default export was not
  made by `defineAction`;
- aborts the handler's `signal` on `SIGTERM`;
- fails, naming the calls, when tool or cache calls are still running after the handler settles;
- fails when the handler waits on a promise that nothing is left to settle;
- writes `{"status": "succeeded"}` or `{"status": "failed"}` to `SHIPFOX_ACTION_RESULT`. A throw
  or an unhandled rejection prints the stack and exits 1. An action that calls `process.exit`
  before the handler settles leaves no result, so the runner cannot count it as a success.

The runner will set a state file in `SHIPFOX_STATE` for the post entry once post execution is implemented; see [Post entry](#post-entry).

The runner sets three files for the steps that follow, as it does for run steps. `setEnv`,
`addPath`, and `addMask` append to them right away, so the values survive a later throw:

- `SHIPFOX_ENV` holds environment variables, one `NAME=value` per line or `NAME<<DELIMITER`
  blocks for multi-line values. Later run, action, and agent steps in the job see them. Step
  `env` overrides them. `PATH` and names starting with `SHIPFOX_` fail the step.
- `SHIPFOX_PATH` holds one directory per line. A relative directory resolves against the step
  working directory. Later steps get these directories at the front of `PATH`, latest first.
- `SHIPFOX_MASK` holds one value per line. The runner replaces each value with `***` in the
  logs, outputs, and annotations of later steps, and in the outputs of this step. Logs the action
  already wrote stay as they are. A value shorter than 8 characters fails the step, so `addMask`
  throws for one. For a multi-line value, `addMask` writes each line of at least 8 characters.

The runner reads the files after the process exits, whatever its exit code, so a failing action
still hands its values on. If a file is invalid, no values from the step are handed on. When the
action also failed, the step log names the invalid file. A runner that does not set a file makes
its helper throw. `runAction` sets the files and returns them as `carriedEnv`, `carriedPath`, and
`masks`.

The loader decides by importer:

- `@shipfox/actions` and its entry points resolve to the bootstrap's own copy, for every importer.
- A bare specifier imported from an action file resolves from the step working directory. A
  missing package fails with "Install it in an earlier step; actions resolve packages from the
  step working directory."
- Imports from installed packages keep Node's resolution, so a package finds its own
  dependencies under pnpm's isolated layout.
- A relative import that leaves the action directory fails.
- With `SHIPFOX_ACTION_ORIGIN=registry`, the loader is strict: a bare specifier imported from an
  action file, other than `@shipfox/actions*` or a Node built-in, fails with
  `ERR_SHIPFOX_REGISTRY_ACTION_IMPORT`. Registry actions bundle their dependencies. Any other
  value resolves from the step working directory.

TypeScript action files run through Node's type stripping. TypeScript packages under
`node_modules` are not supported.

## Development

```sh
turbo check --filter=@shipfox/actions
turbo type --filter=@shipfox/actions
turbo test --filter=@shipfox/actions
turbo build --filter=@shipfox/actions
```

## License

MIT
