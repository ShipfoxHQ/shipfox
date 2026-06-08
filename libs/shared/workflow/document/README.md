# Shipfox Workflow Document

External workflow document schemas for Shipfox authoring tools.

## What it does

- **`workflowDocumentSchema`**: Checks the external workflow object with Zod.
- **`WorkflowDocument`**: Gives TypeScript code the matching input type.
- **`workflowDocumentJsonSchema`**: Exposes the same contract as a JSON Schema object.
- **`@shipfox/workflow-document/schema`**: Exports the checked-in JSON Schema file for tools.
- **`simpleBuildWorkflowDocument`**: Provides a small valid workflow example for tests and docs.

Use this package at the edge, before a file is saved or sent to the API. Good input can move on with less risk. Bad input stops early.

Use it when the first part must say yes or stop before the next part. If it says yes, the next part can do more work. If it must stop, show the bad part near that place.

Keep this part small. It should have one job and do that job well. When a new thing is needed, add the shape here, then let the next part say what it means. This way the same shape can be used by more than one tool.

## Installation

```bash
pnpm add @shipfox/workflow-document
```

## Usage

```ts
import {workflowDocumentJsonSchema, workflowDocumentSchema} from '@shipfox/workflow-document';

const workflowDocument = workflowDocumentSchema.parse({
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

workflowDocument.jobs.build.steps[0]?.run; // "npm run build"
workflowDocumentJsonSchema.title; // "Shipfox Workflow Document"
```

The JSON Schema file is also exported for tools that read JSON directly:

```ts
import workflowDocumentSchemaJson from '@shipfox/workflow-document/schema' with {type: 'json'};
```

## Behavior Notes

- This package owns the external shape only. Definitions, defaults, semantic checks, database rows, and runtime behavior stay in their owning modules.
- Treat this package as an edge guard. It says whether input has the right form before another module gives that input meaning.
- Keep the public shape and the JSON Schema file in step. A schema change should update examples and tests in the same change.

Keep rules here small. If a check needs project state, put that check in the module that owns that state. This package does not choose a runner, start a job, save data, or call another service.

This split keeps the first step easy to test. A reader can tell when a value is not shaped like a workflow. Later code can still apply rules that need a project, a user, a runner, or data from the store.

## Development

```sh
turbo build --filter=@shipfox/workflow-document
turbo check --filter=@shipfox/workflow-document
turbo type --filter=@shipfox/workflow-document
turbo test --filter=@shipfox/workflow-document
```

## License

MIT
