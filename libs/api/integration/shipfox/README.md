# Shipfox integration provider

The `@shipfox/api-integration-shipfox` package provides the built-in Shipfox workflow tool provider.

## What it does

- **`ShipfoxAgentToolsProvider`** starts workflows and reads projects, workflow definitions and their source, runs, jobs and job outputs, step attempts, job explanations, step logs, run annotations, and the documentation.
- **`shipfoxAgentToolCatalog`** describes the thirteen current Shipfox tools for workflows, runs, jobs, logs, and documentation.
- **`shipfoxConversationToolCatalog`** lists the tools a conversation can call. It omits `list_projects`, has no `project_id` parameter, takes no `idempotency_key` on `start_workflow_run`, and uses a flat `get_step_logs` schema because Claude rejects a top-level `oneOf`.
- **`shipfoxAgentToolSelectionCatalog`** exposes the standalone tool selector.
- **`createShipfoxAgentToolsProvider`** creates a provider with agent, annotations, definitions, docs, logs, projects, triggers, and workflow clients.

The provider uses the caller workspace and starts the child with the caller run as its parent. It has no connection row, database, or secrets.

## Installation and setup

Add the package to an integration composition package:

```json
{
  "dependencies": {
    "@shipfox/api-integration-shipfox": "workspace:*",
    "@shipfox/node-docs-client": "workspace:*"
  }
}
```

Pass the annotations, definitions, logs, projects, triggers, and workflows inter-module clients when creating the provider, plus a `docs` cache from `@shipfox/node-docs-client` for `search_docs`.

## Usage

```ts
import {
  createShipfoxAgentToolsProvider,
} from '@shipfox/api-integration-shipfox';

const provider = createShipfoxAgentToolsProvider({
  agent,
  annotations,
  definitions,
  docs,
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

`callerKind` is required. Use `tool_step` for workflow tool execution, `agent` for agent leases, and `conversation` for a server-side agent turn.

A conversation caller has no run. It carries `projectId`, `conversationId`, `agentKey`, `turnId`, `callItemId`, and an optional `actorUserId`, and it can't leave its project:

- `project_id` is rejected on every tool.
- A run, job, or step in another project answers `not-found`, exactly like one that doesn't exist. A definition in another project does too.
- A parent run in another project reads as a null `parent_run`.
- `list_projects` returns `invalid-request`.
- `start_workflow_run` starts a root run in the conversation's project, for `actorUserId`, and stores the conversation in the manual trigger payload so the run page can name the agent. The idempotency key is `conversation:<conversationId>:<callItemId>`, so a repeated call returns the same run. A conversation with no `actorUserId` can't start runs. Each new start spends one of the conversation's run starts, and a message from a person gives them back. When they are used, the tool returns `run-budget-exhausted` and starts nothing. A repeated call doesn't spend the budget again.

Lease callers keep their workspace-wide reads.

A tool-step caller can pass `secrets` as a map from child input names to secret keys in the parent project's scope. Both names use `^[A-Z_][A-Z0-9_]*$`, and the map can contain at most 20 entries. The map is forwarded by reference, so logs contain names only. Agent callers cannot pass `secrets`; the tool returns `secrets-not-allowed` and starts no child run. An omitted map uses trigger defaults, while `{}` explicitly supplies an empty map.

The target workflow must have a synced `manual` trigger. The call returns after the child run exists and does not wait for completion. Inputs are stored in clear on the child run, so they must not contain secrets. Read tools use workspace-scoped producer clients: `get_step_logs` reads a bounded direct or failed-step tail, and `get_run_annotations` pages the latest or requested run attempt. `get_workflow_job` returns the job outputs, such as `pr_url`, and drops them with `outputs_truncated` above 64 KiB. `get_workflow_definition_source` pages the YAML by whole lines through `from_line` and `next_from_line`. `search_docs` returns `docs-unavailable` when the docs site is off. `get_step_log_download` is not offered, because it returns a shell recipe.

## Development

Run package checks from the repository root:

```sh
mise exec -- turbo check --filter=@shipfox/api-integration-shipfox
mise exec -- turbo type --filter=@shipfox/api-integration-shipfox
mise exec -- turbo test --filter=@shipfox/api-integration-shipfox
```

## License

MIT
