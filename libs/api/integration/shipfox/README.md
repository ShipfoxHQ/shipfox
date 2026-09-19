# Shipfox integration provider

The `@shipfox/api-integration-shipfox` package provides the built-in Shipfox workflow tool provider.

## What it does

- **`ShipfoxAgentToolsProvider`** starts a synced workflow from a workflow tool call.
- **`shipfoxAgentToolCatalog`** describes the `start_workflow_run` tool for workflow definitions and documentation generation.
- **`shipfoxAgentToolSelectionCatalog`** exposes the standalone tool selector.
- **`createShipfoxAgentToolsProvider`** creates a provider with definitions, triggers, and workflow clients.

The provider uses the caller workspace and starts the child with the caller run as its parent. It has no connection row, database, or secrets.

## Installation and setup

Add the package to an integration composition package:

```json
{
  "dependencies": {
    "@shipfox/api-integration-shipfox": "workspace:*"
  }
}
```

Pass the definitions, triggers, and workflows inter-module clients when creating the provider.

## Usage

```ts
import {
  createShipfoxAgentToolsProvider,
} from '@shipfox/api-integration-shipfox';

const provider = createShipfoxAgentToolsProvider({
  definitions,
  triggers,
  workflows,
});

const session = await provider.openSession({
  connection: builtinConnection,
  tools: provider.catalog(),
  scope: {},
  caller: {
    workspaceId,
    projectId,
    runId,
    jobExecutionId,
    stepId,
    stepAttempt: 1,
  },
});

const result = await session.call({
  toolId: 'start_workflow_run',
  arguments: {workflow: '.shipfox/workflows/deploy.yml'},
});
await session.close?.();
```

The target workflow must have a synced `manual` trigger. The call returns after the child run exists and does not wait for completion. Inputs are stored in clear on the child run, so they must not contain secrets.

## Development

Run package checks from the repository root:

```sh
mise exec -- turbo check --filter=@shipfox/api-integration-shipfox
mise exec -- turbo type --filter=@shipfox/api-integration-shipfox
mise exec -- turbo test --filter=@shipfox/api-integration-shipfox
```

## License

MIT
