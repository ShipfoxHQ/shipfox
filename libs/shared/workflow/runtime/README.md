# Shipfox Workflow Runtime

Runtime scheduling helpers for Shipfox workflows.

## What it does

- **`RuntimeDagNode`**: Describes a materialized runtime node with its
  dependency names.
- **`RuntimeCompletionStatus`**: Describes whether a runtime node succeeded or
  failed.
- **`findReadyNodes(nodes, completed)`**: Returns nodes that can start because
  all dependencies succeeded.
- **`findBlockedNodes(nodes, completed)`**: Returns nodes that cannot start
  because at least one dependency failed.

## Installation / Setup

```json
{
  "dependencies": {
    "@shipfox/workflow-runtime": "workspace:*"
  }
}
```

## Usage

```ts
import {findBlockedNodes, findReadyNodes} from '@shipfox/workflow-runtime';

const jobs = [
  {name: 'build', dependencies: []},
  {name: 'test', dependencies: ['build']},
];

const completed = new Map([['build', 'succeeded' as const]]);

findReadyNodes(jobs, completed); // [{name: 'test', dependencies: ['build']}]
findBlockedNodes(jobs, completed); // []
```

## Behavior Notes

This package works on runtime DAG state. It does not read `WorkflowIR`,
database rows, or YAML.

The helpers are pure. They do not call Temporal. They do not write database
rows, run commands, or talk to runners. The durable execution host stays in
`@shipfox/api-workflows`.

The code in this package can run inside Temporal workflows. Keep it
deterministic and free of runtime dependencies.

Node identity is the `name` field. Names must be unique in a run. Dependencies
must point to existing names before this package receives them.

## Development

```sh
turbo build --filter=@shipfox/workflow-runtime
turbo check --filter=@shipfox/workflow-runtime
turbo type --filter=@shipfox/workflow-runtime
turbo test --filter=@shipfox/workflow-runtime
```

## License

MIT
