# Shipfox Module

Module setup helpers for Shipfox API services. A module can list its database, request auth, login methods, routes, outbox publishers, event handlers, service metrics, and Temporal workers in one object.

## What it does

- **`initializeModules({modules})`**: Sets up modules in array order.
- **`registerModuleMetrics({modules})`**: Registers service-level metrics for modules that declare a metrics hook.
- **`runModuleStartupTasks({modules})`**: Runs module startup tasks in declaration order after initialization.
- **`startModuleWorkers({workers})`**: Creates Temporal workers and returns a handle that drains workers and closes their Temporal resources.
- **`ShipfoxModule`**: Module contract used by API packages.
- **`loginMethods`**: Declares user-facing ways to establish a Shipfox session.
- **`aggregateLoginMethods({modules})`**: Checks that a composition has one or more unique login method identifiers.
- **Publisher registry**: Adds outbox tables, drains pending events, and marks events as sent.
- **Subscriber registry**: Adds and reads in-process event handlers by event type.

## Usage

```ts
import {createApp, listen} from '@shipfox/node-fastify';
import {
  initializeModules,
  registerModuleMetrics,
  runModuleStartupTasks,
  startModuleWorkers,
} from '@shipfox/node-module';
import {authModule} from '@shipfox/api-auth';

const modules = [authModule];
const {auth, routes, workers} = await initializeModules({
  modules,
});
registerModuleMetrics({modules});
await runModuleStartupTasks({modules});

await createApp({auth, routes});
const moduleWorkers = await startModuleWorkers({workers});
await listen();
```

`initializeModules` runs module migrations first. It exposes auth methods and routes after that. Put modules with shared database needs earlier in the array. Call `registerModuleMetrics` once after instrumentation has started and migrations have run, so observable gauges can query shared storage safely.
Worker startup failures reject `startModuleWorkers`, so call it before serving traffic when workers are required for app health. Call `runModuleStartupTasks` after initialization so migrations complete first. The returned worker handle is idempotent and stops workers before releasing the shared Temporal connection and client.

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
  loginMethods: [{id: 'example-login'}],
  routes: [routes],
  metrics: registerExampleServiceMetrics,
  startupTasks: warmExampleCache,
  publishers: [{name: 'example', table: outbox, db}],
  subscribers: [subscriber('example.created', handleExampleCreated)],
  workers: [{taskQueue: 'example', workflowsPath, activities, workflows: []}],
};
```

## Login methods

A server composition must declare at least one login method. Server construction fails when none are declared. The error explains how to add a module contribution.

External identity modules contribute their own stable identifier:

```ts
import type {ShipfoxModule} from '@shipfox/node-module';

export const acmeSsoModule: ShipfoxModule = {
  name: 'acme-sso',
  loginMethods: [{id: 'acme-sso'}],
};
```

Each identifier has one owning module. Duplicate identifiers fail during server construction. A module that contributes a login method must also create a login-ready session for a verified, active user.

## Development

```sh
turbo check --filter=@shipfox/node-module
turbo type --filter=@shipfox/node-module
turbo test --filter=@shipfox/node-module
```

## License

MIT
