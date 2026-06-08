# Shipfox Workflow Config

Schemas and examples for Shipfox workflow files.

## What it does

- **`workflowConfigSchema`**: Checks a workflow object with Zod.
- **`WorkflowConfig`**: Gives TypeScript code the matching type.
- **`workflowConfigJsonSchema`**: Exposes the public contract as JSON Schema.
- **`workflow-config.schema.json`**: Gives tools a checked-in JSON file to read.
- **`simpleBuildWorkflowConfig`**: Shows a small workflow that passes the checks.

Use this package before any app stores or runs a workflow. It says which keys may appear and which values must be present.

This package owns syntax only. Definitions, defaults, deeper checks, database rows, and runtime behavior stay in their owning modules.

Think of it as a small guard at the edge. An app, tool, or test can use it before work moves to the API. It does not pick a runner, start a job, save data, or call another service. Those steps happen later, in the module that owns them.

The goal is to fail early, near the place where a file is read. Later code can start from a known shape. If a rule needs more state, keep that rule out of this package and put it in the module that has that state.

This makes each next step easier to test. A bad input stops at the door. Good input can move on with less risk.

It also helps new people see where work should go and where it should not go.

Keep it small.

Do less here.

## Installation

```bash
pnpm add @shipfox/workflow-config
```

## Usage

```ts
import {workflowConfigJsonSchema, workflowConfigSchema} from '@shipfox/workflow-config';

const config = workflowConfigSchema.parse({
  name: 'simple build',
  triggers: {
    main_push: {
      source: 'github',
      event: 'push',
      filter: 'event.ref == "refs/heads/main"',
    },
  },
  jobs: {
    build: {
      runner: 'ubuntu-latest',
      steps: [{run: 'npm run build'}],
    },
  },
});

workflowConfigJsonSchema.title; // "Shipfox Workflow Config"
config.jobs.build.steps[0]?.run; // "npm run build"
```

The JSON Schema file is also exported for tools that read JSON directly:

```ts
import workflowConfigSchemaJson from '@shipfox/workflow-config/schema' with {type: 'json'};
```

## Behavior Notes

- Workflow objects are strict. Unknown keys are rejected.
- `jobs` must contain at least one job.
- A trigger must use either `event` or `on`, not both.
- Empty runner, needs, trigger, and step arrays are rejected.
- Expression fields such as trigger `filter` stay as strings in this package.
- Gate fields such as `gate.success_if` and `gate.on_failure` are planned for a later change.

## Development

```sh
turbo build --filter=@shipfox/workflow-config
turbo check --filter=@shipfox/workflow-config
turbo type --filter=@shipfox/workflow-config
turbo test --filter=@shipfox/workflow-config
```

## License

MIT
