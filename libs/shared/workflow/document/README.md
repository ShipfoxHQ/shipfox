# Workflow Document

Workflow document input shape for Shipfox tools.

## What it does

- `workflowDocumentSchema` defines the accepted Zod shape for a workflow document.
- `parseWorkflowDocument` parses unknown input into a typed `WorkflowDocument`.
- `InvalidWorkflowDocumentError` reports invalid input with the original Zod error as `cause`.

Use this package where Shipfox accepts a workflow object from a file, tool, or API call. It checks the shape only. It does not add defaults, pick runners, check job links, save data, or run jobs.

Keep it near the edge of the system. If the value is good, pass it to the next layer. If the value is bad, show the fields from the Zod error to the user.

Use it when a file, form, or tool may send data that is wrong. The call gives one clear yes or no. Good data can move on. Bad data stops here, close to the place where it came in.

## Installation

```sh
pnpm add @shipfox/workflow-document
```

## Usage

```ts
import {InvalidWorkflowDocumentError, parseWorkflowDocument} from '@shipfox/workflow-document';

try {
  const document = parseWorkflowDocument({
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

  document.jobs.build.steps[0]?.run; // "npm run build"
} catch (error) {
  if (error instanceof InvalidWorkflowDocumentError) {
    error.code; // "invalid-workflow-document"
    error.validationError.issues; // Zod issues for presentation boundaries
  }

  throw error;
}
```

## Behavior Notes

- The public contract is the Zod schema and the TypeScript types built from it.
- Bad input throws a typed `Error`; UI or API code can read `validationError.issues` for field details.
- Rules about what a workflow means belong to definitions-owned code, not this package.

This package should stay small. Add only fields that are part of the input shape. Put rules that need a project, user, runner, or saved state in another module.

That split keeps each part easy to test. This part checks form. Other parts can check meaning.

Test shape here. Test meaning with the code that gives the value meaning. That way each test has one job.

Keep that line clear as the system grows.

It is better to stop bad things early than to let them move through many parts.

## Development

```sh
turbo build --filter=@shipfox/workflow-document
turbo check --filter=@shipfox/workflow-document
turbo type --filter=@shipfox/workflow-document
turbo test --filter=@shipfox/workflow-document
```

## License

MIT
