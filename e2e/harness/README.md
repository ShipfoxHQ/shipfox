# E2E harness

Process orchestration for local Shipfox E2E suites.

## What it does

- **`runE2e`** starts consumer-provided servers in order, waits for readiness, runs the Turbo test task, and shuts down child processes.
- **`baseE2eEnv`** builds the local environment shared by E2E consumers and rejects remote API or client URLs.
- **`startFakeRouters`** starts the provider routers used by integration fakes.
- **`collectE2eDiagnostics`** collects Docker, runner, and Playwright artifacts after a failure.
- **`copyPlaywrightTestResults`** copies suite test results into the diagnostic directory.

## Installation and setup

Install the package with the API and client versions used by the E2E suite:

```sh
pnpm add -D @shipfox/e2e-harness
```

The package expects a local E2E deployment. The API and client must listen on local, reachable URLs.

## Usage

```js
import {baseE2eEnv, runE2e} from '@shipfox/e2e-harness';

const exitCode = await runE2e({
  argv: process.argv.slice(2),
  env: (source) => baseE2eEnv(source),
  servers: [
    {
      name: 'api',
      command: 'pnpm',
      args: ['--filter=@shipfox/api', 'dev:e2e'],
      ready: '/readyz',
    },
    {
      name: 'client',
      command: 'pnpm',
      args: ['--filter=@shipfox/client', 'dev'],
      ready: (env) => env.CLIENT_URL,
    },
  ],
  diagnostics: [],
});

process.exitCode = exitCode;
```

A relative readiness path resolves against `API_URL`. Add a `before` server name when a server must start before another server. The harness waits for each readiness check before starting the next server.

## Development

Run the package tests from the repository root:

```sh
pnpm --filter=@shipfox/e2e-harness test
```

## License

MIT
