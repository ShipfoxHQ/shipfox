# Shipfox Temporal

Temporal client and worker helpers for Shipfox Node services.

## What it does

- **`createTemporalClient()`**: Connects to Temporal and stores one shared client.
- **`temporalClient()`**: Returns the current client or throws if it has not been created.
- **`closeTemporalClient()`**: Closes the Temporal connection.
- **`isTemporalHealthy()`**: Checks the Temporal connection health service.
- **`createTemporalWorkerConnection()`**: Creates a Temporal worker connection for a caller that owns its lifecycle.
- **`createTemporalWorker(options)`**: Creates a worker with Shipfox defaults.
- **Prebuilt workflow bundles**: Builds and loads production workflow artifacts without bundling at worker startup.
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
  createTemporalWorkerConnection,
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

To share and close a connection outside the worker, create it explicitly and pass it to each worker:

```ts
const connection = await createTemporalWorkerConnection();
const worker = await createTemporalWorker({
  connection,
  workflowsPath: new URL('./workflows.js', import.meta.url).pathname,
  activities: {syncActivity},
});

await worker.shutdown();
await connection.close();
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
- Setting `TEMPORAL_API_KEY` for a `tmprl.cloud` address enables TLS for clients and workers.
- A `tmprl.cloud` address without `TEMPORAL_API_KEY` stops startup with a configuration error.
- A non-Cloud address with `TEMPORAL_API_KEY` also stops startup so the key cannot be sent to it.
- This package does not configure mutual TLS (mTLS) client certificates.
- Production packages run `shipfox-temporal-bundle` after SWC emits a workflow entrypoint. The command writes sibling `*.bundle.js` and `*.bundle.meta.json` files.
- Production workers load the bundle instead of compiling it. Startup fails when an artifact is missing. It also fails when the `@temporalio/worker` version differs from the runtime version.
- Development workers keep using `workflowsPath`. The bundle build includes workflow interceptors. Production workers do not pass workflow interceptor modules.

## Development

```sh
turbo check --filter=@shipfox/node-temporal
turbo type --filter=@shipfox/node-temporal
turbo test --filter=@shipfox/node-temporal
```

## License

MIT
