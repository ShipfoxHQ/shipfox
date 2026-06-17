# Workflow Document

Input shape for Shipfox workflow authoring.

## What it does

- `workflowDocumentSchema` defines the accepted Zod shape for a workflow document.
- `parseWorkflowDocument` parses unknown input into a typed `WorkflowDocument`.
- `InvalidWorkflowDocumentError` reports invalid input with the original Zod error as `cause`.
- `WorkflowDocumentRunStepGate` describes the step `gate` block with `success_if`
  and `on_failure`.
- A job step is either a **run step** (`run: <shell command>`) or an inline
  **agent step** (`model` + `prompt`, with an optional `thinking` level). A step
  carries one or the other, never both.

Use this package where Shipfox accepts a workflow object from a file, tool, or
API call. It checks the shape only. It does not add defaults, pick runners,
check job links, save data, or run jobs.

Keep it near the edge of the system. If the value is good, pass it to the next
layer. If the value is bad, show the fields from the Zod error to the user.

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
        steps: [{run: 'npm run build', gate: {success_if: 'exit_code == 0'}}],
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

A step can also be an inline agent step. It declares a `model` and a `prompt`
(no `run`), with an optional `thinking` level that defaults to `high`. The
recommended pattern is an agent step that produces a change, followed by a `run`
step whose `gate` judges the result:

```ts
parseWorkflowDocument({
  name: 'agent build',
  jobs: {
    fix: {
      steps: [
        {model: 'claude-opus-4-8', prompt: 'Fix the failing tests.'},
        {run: 'npm test', gate: {success_if: 'exit_code == 0'}},
      ],
    },
  },
});
```

## Behavior Notes

- The public contract is the Zod schema and the TypeScript types built from it.
- Bad input throws a typed `Error`; UI or API code can read `validationError.issues` for field details.
- The `gate` block is checked as input shape here. CEL parsing and restart
  target checks belong to definitions-owned model code.
- A step is discriminated by which keys it carries: `run` marks a run step;
  `model` + `prompt` (both required) mark an agent step; declaring both, or
  neither, is rejected. `thinking` is optional and validated against a fixed set
  (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`); the `high` default is
  applied later in the model layer, not here. `model` is free text, so an unknown
  model is accepted at parse time and fails later at runtime. The `agent` key is
  reserved for a future step kind and is rejected today.
- Rules that need a project, user, runner, database row, or saved state belong
  outside this package.

This package answers one question: does this value have the right fields. The
next layer can then decide what those fields mean. Keeping that split clear
makes errors easier to show and tests easier to read.

A file can come from a person, a tool, or a form. This part checks it before any
other part uses it. Good data moves on. Bad data stops close to where it came
from. That gives the caller a clear place to show what must change.

This keeps the first step fast and easy to use. It also lets later code work
with a value that has already passed the basic shape check.

Use it at the start of a flow. Do not wait until save time. The sooner this
part runs, the easier it is to tell the caller what is wrong and ask for a
small fix.

## Development

```sh
turbo build --filter=@shipfox/workflow-document
turbo check --filter=@shipfox/workflow-document
turbo type --filter=@shipfox/workflow-document
turbo test --filter=@shipfox/workflow-document
```

## License

MIT
