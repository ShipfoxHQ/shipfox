# Shipfox Workflow Config

External workflow file schemas for Shipfox authoring tools.

## What it does

- **`workflowConfigSchema`**: Checks the external workflow object with Zod.
- **`WorkflowConfig`**: Gives TypeScript code the matching input type.
- **`workflowConfigJsonSchema`**: Exposes the same contract as a JSON Schema object.
- **`@shipfox/workflow-config/schema`**: Exports the checked-in JSON Schema file for tools.
- **`simpleBuildWorkflowConfig`**: Provides a small valid workflow example for tests and docs.

Use this package at the edge, before a file is saved or sent to the API. Good input can move on with less risk. Bad input stops early.

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

config.jobs.build.steps[0]?.run; // "npm run build"
workflowConfigJsonSchema.title; // "Shipfox Workflow Config"
```

The JSON Schema file is also exported for tools that read JSON directly:

```ts
import workflowConfigSchemaJson from '@shipfox/workflow-config/schema' with {type: 'json'};
```

## Behavior Notes

- This package owns the external shape only. Definitions, defaults, semantic checks, database rows, and runtime behavior stay in their owning modules.
- Treat this package as an edge guard. It says whether input has the right form before another module gives that input meaning.
- Keep the public shape and the JSON Schema file in step. A schema change should update examples and tests in the same change.

Keep rules here small. If a check needs project state, put that check in the module that owns that state. This package does not choose a runner, start a job, save data, or call another service.

This split keeps the first step easy to test. A reader can tell when a value is not shaped like a workflow. Later code can still apply rules that need a project, a user, a runner, or data from the store. Each module stays clear about the work it owns.

When a new concept is added here, start with the public type, then the example, then the tests. Keep the change small so review can focus on one part. Do not add rules that need live data.

Small changes are better here. They make review faster and safer for the team.

If in doubt, keep the rule out until the right owner is clear.

Ask first before more work.

This package should stay easy to read. Good input can move to the next step. Bad input should stop near the place where it was read. The next module can then do its own work with less guesswork.

## Development

```sh
turbo build --filter=@shipfox/workflow-config
turbo check --filter=@shipfox/workflow-config
turbo type --filter=@shipfox/workflow-config
turbo test --filter=@shipfox/workflow-config
```

## License

MIT
