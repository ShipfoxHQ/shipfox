# Shipfox integration provider

The `@shipfox/api-integration-shipfox` package provides the built-in Shipfox workflow tool provider.

## What it does

- **`ShipfoxAgentToolsProvider`** starts workflows and reads projects, workflow definitions, workflow runs, step logs, and run annotations.
- **`shipfoxAgentToolCatalog`** describes the seven current Shipfox tools for workflow definitions and documentation generation.
- **`shipfoxAgentToolSelectionCatalog`** exposes the standalone tool selector.
- **`createShipfoxAgentToolsProvider`** creates a provider with annotations, definitions, logs, projects, triggers, and workflow clients.

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

Pass the annotations, definitions, logs, projects, triggers, and workflows inter-module clients when creating the provider.

## Usage

```ts
import {
  createShipfoxAgentToolsProvider,
} from '@shipfox/api-integration-shipfox';

const provider = createShipfoxAgentToolsProvider({
  annotations,
  definitions,
  logs,
  projects,
  triggers,
  workflows,
});

const session = await provider.openSession({
  connection: builtinConnection,
  tools: provider.catalog(),
  scope: {},
  caller: {
    callerKind: 'tool_step',
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

`callerKind` is required. Use `tool_step` for workflow tool execution and `agent` for agent leases.

A tool-step caller can pass `secrets` as a map from child input names to secret keys in the parent project's scope. Both names use `^[A-Z_][A-Z0-9_]*$`, and the map can contain at most 20 entries. The map is forwarded by reference, so logs contain names only. Agent callers cannot pass `secrets`; the tool returns `secrets-not-allowed` and starts no child run. An omitted map uses trigger defaults, while `{}` explicitly supplies an empty map.

The target workflow must have a synced `manual` trigger. The call returns after the child run exists and does not wait for completion. Inputs are stored in clear on the child run, so they must not contain secrets. Read tools use workspace-scoped producer clients: `get_step_logs` reads a bounded direct or failed-step tail, and `get_run_annotations` pages the latest or requested run attempt.

## Development

Run package checks from the repository root:

```sh
mise exec -- turbo check --filter=@shipfox/api-integration-shipfox
mise exec -- turbo type --filter=@shipfox/api-integration-shipfox
mise exec -- turbo test --filter=@shipfox/api-integration-shipfox
```

## License

MIT
