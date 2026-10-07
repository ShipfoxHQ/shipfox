# E2E Core

Shared transport, configuration, polling, and Playwright exports for Shipfox E2E packages.

## What it does

- **`config`** reads the API and client URLs and the E2E administrator key.
- **`createApiClient`** creates a typed-token client for consumer-owned E2E setup and observation routes.
- **`request` and `requestJson`** call the configured E2E API routes with the administrator key.
- **`pollUntil`** retries an asynchronous probe until it returns a value or reaches its timeout.
- **`preflightCheck`** verifies that an E2E API is ready for a suite.
- **`listenFake`, `listenOnEndpoint`, and `closeServer`** support local HTTP fakes.
- **`@shipfox/e2e-core/api`** exposes the API client symbols without the other helpers.
- **`@shipfox/e2e-core/playwright`** re-exports the shared Playwright `test` and `expect` functions.

## Installation and setup

Install the package in an E2E consumer:

```sh
pnpm add @shipfox/e2e-core
```

Set the variables listed in [Environment](#environment) before running the suite.

## Usage

Create a client and poll a public E2E read until it returns a result:

```ts
import {config, createApiClient, pollUntil} from '@shipfox/e2e-core';

const api = createApiClient({token: config.E2E_ADMIN_API_KEY});
const workspace = await pollUntil(
  {
    timeoutMs: 30_000,
    describe: () => 'the workspace to become available',
  },
  () => api.requestJson<{id: string}>('get', '/workspaces/current'),
);

console.log(`Workspace: ${workspace.id}`);
```

## Environment

| Variable | Purpose |
| --- | --- |
| `API_URL` | Base URL of the API under test. |
| `API_PUBLIC_URL` | Public API URL used by OAuth flows. |
| `CLIENT_URL` | Base URL of the client under test. |
| `CLIENT_BASE_URL` | Public client URL accepted by API origin checks. |
| `E2E_ADMIN_API_KEY` | Administrator key for E2E setup routes. |

The package supplies local defaults for direct package runs. A harness should provide the URLs for its own instance.

## Development

Run the package checks from the repository root:

```sh
turbo check --filter=@shipfox/e2e-core
turbo type --filter=@shipfox/e2e-core
turbo build --filter=@shipfox/e2e-core
turbo test --filter=@shipfox/e2e-core
```

## License

MIT
