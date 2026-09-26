# Shipfox event DTOs

`@shipfox/api-integration-shipfox-dto` defines DTOs for Shipfox lifecycle events.

## What it does

- **`shipfoxEventCatalog`** describes the six Shipfox lifecycle events, one family per event.
- **`shipfoxEventPayloadSchemas`** maps each event name to its payload schema.
- **Shipfox event name constants** identify the six run and job lifecycle events.
- **Shipfox payload schemas** parse the normalized payload for each lifecycle event.
- **`SHIPFOX_BUILTIN_CONNECTION_ID`** identifies the first-party synthetic Shipfox integration connection.

## Installation and setup

Add the package to a workspace package:

```json
{
  "dependencies": {
    "@shipfox/api-integration-shipfox-dto": "workspace:*"
  }
}
```

## Usage

Parse a normalized event payload before dispatching it:

```ts
import {
  SHIPFOX_RUN_COMPLETED_EVENT,
  shipfoxRunCompletedEventPayloadSchema,
} from '@shipfox/api-integration-shipfox-dto';

const event = {
  project: {id: '0198a100-0000-7000-8000-000000000001', name: 'api'},
  workflow: {
    id: '0198a100-0000-7000-8000-000000000002',
    name: 'Build',
    path: '.shipfox/workflows/build.yml',
  },
  run: {
    id: '0198a100-0000-7000-8000-000000000003',
    number: 42,
    attempt: 1,
    name: 'Build',
    origin: 'synced',
    trigger: {source: 'github', event: 'push'},
    ref: null,
    commit: null,
    parent_run_id: null,
    root_run_id: null,
    created_at: '2026-09-26T10:00:00Z',
    status: 'succeeded',
    status_reason: null,
    started_at: '2026-09-26T10:01:00Z',
    finished_at: '2026-09-26T10:02:00Z',
    outputs: {version: '1.2.3'},
  },
};

const payload = shipfoxRunCompletedEventPayloadSchema.parse(event);
console.log(SHIPFOX_RUN_COMPLETED_EVENT, payload.run.outputs);
```

## Development

Run package checks from the repository root:

```sh
mise exec -- turbo check --filter=@shipfox/api-integration-shipfox-dto
mise exec -- turbo type --filter=@shipfox/api-integration-shipfox-dto
mise exec -- turbo test --filter=@shipfox/api-integration-shipfox-dto
```

The package has no service dependencies. Its tests exercise the Zod schemas and catalog shape.

## License

MIT
