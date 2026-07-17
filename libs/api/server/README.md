# Shipfox API Server

Runs a Shipfox API server.

## What it does

- **`defaultModules()`**: Returns the standard module list.
- **`createServer()`**: Builds an API server. The caller owns process signals.
- **`runServer()`**: Starts the server. It listens for SIGTERM and SIGINT.
- **Instrumentation preload**: Starts metrics early. Load it before feature modules.

## Installation

```sh
pnpm add @shipfox/api-server
```

## Usage

```ts
import {defaultModules, runServer} from '@shipfox/api-server';

await runServer({modules: await defaultModules()});
```

Load the instrumentation entry before feature modules:

```sh
node --import @shipfox/api-server/instrumentation ./dist/index.js
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `E2E_ENABLED` | `false` | Enables routes under `/__e2e` when `E2E_ADMIN_API_KEY` is set. |
| `E2E_ADMIN_API_KEY` | none | Required to enable and protect E2E routes. |
| `API_PORT` | shared `PORT` | Sets the listener port. |
| `API_TRUST_PROXY` | `false` | Sets proxy IP checks. |

## Behavior Notes

- **Custom composition**: Pass a module list to make a custom server. A module must declare a unique `loginMethods` entry. `createServer` throws before startup side effects when no login method is available.
- **Signal handling**: `createServer` does not install signal handlers.
- **Lifecycle**: `start` starts workers before the HTTP listener. `stop` is safe to call again.
- **Process scope**: Run one server at a time.

## Development

```sh
turbo build --filter=@shipfox/api-server
turbo check --filter=@shipfox/api-server
turbo type --filter=@shipfox/api-server
turbo test --filter=@shipfox/api-server
```

## License

MIT
