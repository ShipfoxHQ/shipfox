# Shipfox Module

Module setup helpers for Shipfox API services. A module can list its database, auth methods, routes, outbox publishers, event handlers, service metrics, and Temporal workers in one object.

## What it does

- **`initializeModules({modules})`**: Sets up modules in array order.
- **`registerModuleMetrics({modules})`**: Registers service-level metrics for modules that declare a metrics hook.
- **`startModuleWorkers({workers})`**: Creates Temporal workers and starts declared workflows before the app is marked ready.
- **`ShipfoxModule`**: Module contract used by API packages.
- **Publisher registry**: Adds outbox tables, drains pending events, and marks events as sent.
- **Subscriber registry**: Adds and reads in-process event handlers by event type.

## Usage

```ts
import {createApp, listen} from '@shipfox/node-fastify';
import {initializeModules, registerModuleMetrics, startModuleWorkers} from '@shipfox/node-module';
import {authModule} from '@shipfox/api-auth';

const modules = [authModule];
const {auth, routes, workers} = await initializeModules({
  modules,
});
registerModuleMetrics({modules});

await createApp({auth, routes});
await startModuleWorkers({workers});
await listen();
```

`initializeModules` runs module migrations first. It exposes auth methods and routes after that. Put modules with shared database needs earlier in the array. Call `registerModuleMetrics` once after instrumentation has started and migrations have run, so observable gauges can query shared storage safely.
Worker startup failures reject `startModuleWorkers`, so call it before serving traffic when workers are required for app health.

## Module Shape

```ts
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';

interface ExampleEventMap {
  'example.created': {id: string};
}

const subscriber = subscriberFactory<ExampleEventMap>();

async function handleExampleCreated(payload: ExampleEventMap['example.created']): Promise<void> {
  console.log(payload.id);
}

export const exampleModule: ShipfoxModule = {
  name: 'example',
  database: {db, migrationsPath},
  auth: [authMethod],
  routes: [routes],
  metrics: registerExampleServiceMetrics,
  publishers: [{name: 'example', table: outbox, db}],
  subscribers: [subscriber('example.created', handleExampleCreated)],
  workers: [{taskQueue: 'example', workflowsPath, activities, workflows: []}],
};
```

## Development

```sh
turbo check --filter=@shipfox/node-module
turbo type --filter=@shipfox/node-module
turbo test --filter=@shipfox/node-module
```

## License

MIT
