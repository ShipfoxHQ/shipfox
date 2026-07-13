# Shipfox Temporal

Temporal client and worker helpers for Shipfox Node services.

## What it does

- **`createTemporalClient()`**: Connects to Temporal and stores one shared client.
- **`temporalClient()`**: Returns the current client or throws if it has not been created.
- **`closeTemporalClient()`**: Closes the Temporal connection.
- **`isTemporalHealthy()`**: Checks the Temporal connection health service.
- **`createTemporalWorker(options)`**: Creates a worker with Shipfox defaults.
- **Interceptor helpers**: Return client, worker, and workflow settings.

## Installation

```sh
pnpm add @shipfox/node-temporal
```

## Usage

```ts
import {
  createTemporalClient,
  createTemporalWorker,
  temporalClient,
} from '@shipfox/node-temporal';

await createTemporalClient();

await temporalClient().workflow.start('syncWorkflow', {
  taskQueue: 'sync',
  workflowId: 'sync-main',
});

const worker = await createTemporalWorker({
  taskQueue: 'sync',
  workflowsPath: new URL('./workflows.js', import.meta.url).pathname,
  activities: {syncActivity},
});

await worker.run();
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal frontend address. |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace. |
| `TEMPORAL_TASK_QUEUE` | `shipfox` | Default task queue for workers. |
| `TEMPORAL_API_KEY` | none | API key used to connect to Temporal Cloud. Store it as a secret. |

## Behavior notes

- Local connections use no authentication or Transport Layer Security (TLS).
- Setting `TEMPORAL_API_KEY` enables TLS for clients and workers.
- A `tmprl.cloud` address without `TEMPORAL_API_KEY` stops startup with a configuration error.
- This package does not configure mutual TLS (mTLS) client certificates.

## Development

```sh
turbo check --filter=@shipfox/node-temporal
turbo type --filter=@shipfox/node-temporal
turbo test --filter=@shipfox/node-temporal
```

## License

MIT
