# Shipfox Client Chat

Chat with Shippy, the project agent, in a panel beside project pages.

## What it does

- **`chatFeature`**: a client feature with one `projectDock` contribution. The
  shell mounts the dock on project pages, except focused frames and the
  pre-project gate, and keeps it mounted across them, so a reply keeps streaming
  while the user moves around the project.
- **The panel**: a header with History, New conversation, and Close, a
  transcript, and a composer with a context chip that shows which page the
  agent sees.
- **The transcript**: user and agent bubbles, and tool rows that read as they
  do on run pages. Tool rows come from `pairSessionRows` and the action
  presentation in `@shipfox/client-logs`. Reads of one kind group, and a call
  with no result reads as unknown, never failed. A started run gets its own
  `Run started` row with the run number and a link, and it never joins a group
  of reads.
- **Turn states**: thinking, a slow start, stopping, reconnecting, queued
  messages, stopped replies, failures with Retry or Continue, denied messages
  with Send again, a conversation that is too long, a locked model, no model,
  and a conversation deleted in another tab.
- **History**: the user's own conversations in the project, with unread dots
  and delete in a modal.

## Installation and setup

```sh
pnpm add @shipfox/client-chat
```

The package is part of the `libs/client` workspace. It depends on
`client-agent`, `client-api`, `client-logs`, `client-projects`, `client-shell`,
and `client-ui`. A composition includes it through `defaultFeatures()` in
`@shipfox/client-features`.

## Usage

```ts
import {chatFeature} from '@shipfox/client-chat/feature';
import {composeClientFeatures} from '@shipfox/client-shell/runtime';

const composition = composeClientFeatures([chatFeature]);
```

Pages tell the agent where the user is with `useAgentPageContext` from
`@shipfox/client-shell/runtime`. Each message carries the context the page
registered when it was sent.

## Behavior notes

- The panel polls the conversation every 5 seconds while no turn runs, and
  follows `GET /conversations/:id/stream` while one does. Polling pauses while
  the panel is closed, but a turn that runs keeps its stream, so Shippy can tell
  when the reply is ready. Polling also pauses in a hidden tab, but an open
  stream continues until its turn ends.
- The dock publishes Shippy's state with `useShippyStatus` from
  `@shipfox/client-shell/runtime`: `working` while a reply runs or a message
  waits for its turn, `reply_ready` while the latest reply is unread, `failed`
  after a failed turn, and `idle` otherwise. A closed panel never marks a reply
  read.
- A sent message shows at once with a `Queued` chip, below the reply, until a
  turn claims it.
- `Mod+.` opens or closes the panel. `Enter` sends, `Shift+Enter` adds a line,
  and `Esc` stops a reply, or closes the panel when the composer is empty.
- The transcript is a `log` with `aria-live="off"`. One polite status region
  announces that Shippy is replying, the finished reply, and failures.
- Drafts are kept per conversation in session storage, scoped to the signed-in
  user. They are saved on blur, on unmount, and when the page hides.
- A link to a Shipfox page moves the page, and the panel stays open.
- Thinking, raw, lifecycle, and compaction rows aren't shown.

## Development

```sh
turbo check --filter=@shipfox/client-chat
turbo type --filter=@shipfox/client-chat
turbo test --filter=@shipfox/client-chat
turbo build --filter=@shipfox/client-chat
```

The package runs Storybook per the per-package recipe (`pnpm storybook` on
port 6019).

## License

MIT
