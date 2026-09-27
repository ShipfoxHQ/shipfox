# Shipfox API Dispatcher

Shipfox API Dispatcher drains module outboxes and sends events to subscribers.

## What it does

- **`dispatcherModule`**: Registers the in-process drainer and daily Temporal
  retention work.
- **In-process drainer**: Runs as a `ModuleService` in each API process. It
  claims rows with PostgreSQL `SKIP LOCKED` and sends events to subscribers.
- **Competing consumers**: Many API processes can drain the same outbox.
  PostgreSQL claims and row leases keep them apart. No leader election is used.
- **Retention**: Runs once a day on Temporal. Normal event delivery does not.

## Setup

Install the package from the registry:

```sh
pnpm add @shipfox/api-dispatcher
```

Register the module with the API module runner:

```ts
import {dispatcherModule} from '@shipfox/api-dispatcher';
import {initializeModules} from '@shipfox/node-module';

await initializeModules({
  modules: [dispatcherModule],
});
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `OUTBOX_DISPATCHER_ENABLED` | `true` | Starts the in-process drainer. Set `false` to use legacy Temporal dispatch workflows. |
| `OUTBOX_DISPATCH_POLL_MS` | `250` | Time in milliseconds that the drainer waits before it checks the outbox again after it finds work. It must be a whole number greater than zero. |

The default suits an all-in-one deployment. Each API process runs a drainer. No
extra service is required.

Dedicated drainer deployments are deferred. Do not set
`OUTBOX_DISPATCHER_ENABLED=false` on the API tier to scale out the drainer. That
setting restores the legacy Temporal dispatcher. Use the default until a
dedicated-drainer deployment is available.

## Behavior notes

While the outbox stays empty, the drainer doubles its wait after each check, up
to 2 seconds or `OUTBOX_DISPATCH_POLL_MS`, whichever is longer. It returns to `OUTBOX_DISPATCH_POLL_MS` after it claims an event.
An event written in the same process ends an idle wait, and the drainer checks
the outbox one poll interval later. That gives the writer's transaction time to
commit.

Claims create no spans. Each dispatched event gets an `outbox.dispatch` span,
so handler queries and calls appear under it.

The drainer logs an escaped error and waits before it tries again. During
shutdown, it stops claiming rows and waits for work in flight to finish.

## Development

```sh
turbo check --filter=@shipfox/api-dispatcher
turbo type --filter=@shipfox/api-dispatcher
turbo test --filter=@shipfox/api-dispatcher
```

Tests use PostgreSQL. Start local services with `docker compose up -d`.

## License

MIT
