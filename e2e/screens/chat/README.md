# E2E Chat Screens

Typed browser page objects for the Shippy chat panel on project pages.

## What it does

- **`ChatPanelScreen`** opens a project page, opens Shippy from its launcher, sends messages, stops a reply, retries a failed turn, and reads the transcript and the conversation list.
- **`ChatScreenFixtures` and `chatScreens`** add the chat screen to a Playwright fixture as `chatPanel`.

## Installation and setup

Install the screen package with the E2E test tools:

```sh
pnpm add @shipfox/e2e-screens-chat @shipfox/e2e-kit @shipfox/e2e-core
```

The consumer must configure its API and client URLs through the E2E kit before running a suite.

## Usage

Compose the chat screen into a client suite:

```ts
import {test as base} from '@shipfox/e2e-core/playwright';
import {chatScreens} from '@shipfox/e2e-screens-chat';

const test = base.extend({...chatScreens});

test('replies to a message', async ({chatPanel}) => {
  await chatPanel.gotoRuns('acme', 'checkout-api');
  await chatPanel.open();
  await chatPanel.send('What failed recently?');
  await chatPanel.message('Nothing failed this week.').waitFor();
});
```

The locators follow the panel's accessible names, so a copy change in `@shipfox/client-chat` shows up here.

## Development

Run the package checks from the repository root:

```sh
turbo check --filter=@shipfox/e2e-screens-chat
turbo type --filter=@shipfox/e2e-screens-chat
turbo build --filter=@shipfox/e2e-screens-chat
```

## License

MIT
