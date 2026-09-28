# Shipfox Actions

The runtime SDK for Shipfox workflow actions: JavaScript and TypeScript code that a workflow step
runs with `uses: ./path`, calling Shipfox integration tools through the runner.

## What it does

- **`defineAction(handler)`** declares an action. The entry file default-exports the result. The
  handler receives `inputs`, `tools`, `setOutput`, `log`, `signal`, and `context`, and may return
  an object of outputs.
- **`tools.<alias>.call(tool, args, {signal})`** calls a tool granted to a manifest alias and
  returns a `ToolResult`. `tool` is a tool id or `family.method`.
- **`tools.<alias>.download(tool, args, {destination})`** calls a file tool. The runner writes the
  file into the workspace and returns a `DownloadedFile` with `path`, `bytes`, `sha256`,
  `mediaType`, and `filename`.
- **`Aliases`** maps manifest aliases to provider slugs through module augmentation. Tool names
  and arguments are then typed from the provider catalogs. Without it, any tool name and
  `Record<string, unknown>` arguments are accepted. Results stay `unknown` either way.
- **`ToolResult`** holds `structured` (or `null`) and the raw `content` blocks. `text()` joins
  the text blocks. `json()` parses that text and throws when it is not JSON. Text is never parsed
  silently.
- **`ToolCallError`** is thrown for a failed call, with `code`, `reason`, `retryAfterSeconds`,
  `outcomeUnknown`, and `callId`. When `outcomeUnknown` is true, a write may have reached the
  provider, so do not retry it blindly.
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

To type tool arguments, declare every alias of the manifest once, for example in the entry file:

```ts
declare module '@shipfox/actions' {
  interface Aliases {
    slack: 'slack';
  }
}
```

## Behavior notes

- **Outputs follow their declared type.** A `json` output is always written with
  `JSON.stringify`, strings included, so the string `"true"` stays a string. `string`,
  `number`, and `boolean` outputs must hold that type. A top-level `undefined`, `NaN`, cycles, and
  `BigInt` are rejected. Nested `undefined` follows `JSON.stringify`.
- **`setOutput` writes right away**, so the value survives a later throw. The returned object is
  merged over earlier `setOutput` values. A declaration without `required: false` is required.
- **Only `rate-limited` errors are retried**, up to 3 times and within 60 seconds in total,
  waiting `retry_after_seconds` when the runner sends it. No other error is retried.
- **A request above 2 MiB fails with `request-too-large`** before any network call. The limit
  fits a 1 MB `create_commit` after base64.
- **Argument types are generated** from the provider catalogs into `src/generated/tool-catalog.ts`.
  Regenerate them with `pnpm --filter @shipfox/action-tool-types generate`.
- **Downloads** resolve `destination` against the step working directory and must stay inside
  the job workspace, symlinks included. A trailing `/` means a directory: the file keeps the
  provider's name, made safe, or `download-<call id>`, and a taken name gets ` (2)`, ` (3)`, and
  so on. A destination without a trailing `/` names the file and replaces it. A file is limited
  to 100 MiB, all downloads of a step to 1 GiB, and each download to 5 minutes. A failed download
  leaves no file behind.
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
- fails, naming the calls, when tool calls are still running after the handler settles;
- fails when the handler waits on a promise that nothing is left to settle;
- writes `{"status": "succeeded"}` or `{"status": "failed"}` to `SHIPFOX_ACTION_RESULT`. A throw
  or an unhandled rejection prints the stack and exits 1. An action that calls `process.exit`
  before the handler settles leaves no result, so the runner cannot count it as a success.

The loader decides by importer:

- `@shipfox/actions` and its entry points resolve to the bootstrap's own copy, for every importer.
- A bare specifier imported from an action file resolves from the step working directory. A
  missing package fails with "Install it in an earlier step; actions resolve packages from the
  step working directory."
- Imports from installed packages keep Node's resolution, so a package finds its own
  dependencies under pnpm's isolated layout.
- A relative import that leaves the action directory fails.

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
