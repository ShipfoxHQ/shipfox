# Workflow Model

Code that turns a checked workflow document into the model used by definitions.

## What it does

- **`WorkflowModel`**: Defines the stable workflow graph used after document
  parsing.
- **`normalizeWorkflowDocument(document)`**: Applies defaults, expands
  shorthand fields, assigns stable ids, and builds graph edges.
- **Step gates**: Parse run-step `gate.success_if` as CEL with `exit_code` in
  scope and check `gate.on_failure.restart_from` against earlier named steps in
  the same job.
- **`InvalidWorkflowModelError`**: Reports semantic workflow errors found during
  normalization.

Use this module after a workflow document has passed the shared document checks.
It gives later code one shape for jobs, steps, runners, and graph edges. This is
useful even when YAML is the only file format. YAML is for people to write. The
model is for Shipfox code to use.

This split keeps each step clear. The document package checks the public shape.
This module decides what that shape means for jobs and run order. Later code can
use the model without asking how the workflow was written.

Think of this as the hand off from what a person wrote to what the system can
run. A person may use short forms and names that are easy to read. The system
needs one clear form. This module makes that form once, so the rest of the code
does not have to guess.

This is why the module is here. It gives the rest of the app a clear way to do
its work. A test can set up one case, call one thing, and check what comes back.
That keeps the next step easy to read.
It is small.

## Installation / Setup

This code is part of `@shipfox/api-definitions`. It is not a standalone package.

```json
{
  "dependencies": {
    "@shipfox/workflow-document": "workspace:*"
  }
}
```

## Usage

```ts
import {normalizeWorkflowDocument} from '#core/workflow-model/index.js';

const model = normalizeWorkflowDocument({
  name: 'simple build',
  runner: 'ubuntu-latest',
  jobs: {
    build: {
      steps: [{run: 'npm test'}],
    },
  },
});

console.log(model.jobs[0]?.steps[0]?.command.value);
```

## Behavior Notes

The model does not own project ids, commit shas, refs, dates, database rows, or
file paths. Those fields belong to `WorkflowDefinition`.

Trigger filters stay as source strings in this module until event schemas define
the expression context needed to type-check them.

The persisted `workflow_document` keeps author-provided runner labels exactly as
written. Canonical and defaulted labels live on `workflow_model.jobs[].runner`;
downstream consumers should read the model, not `document.runner`.

Run-step gate expressions are different. They have a small local result context,
so this module can parse and type-check `success_if` now. The accepted model
stores a typed `WorkflowExpression` with `language: 'cel'`, the original source
string, and `check: 'typed'`.

For now, run-step gates can use `exit_code`. Fields such as `step.output.pass`
need a declared output schema, so they belong to later agent-step work.

`on_failure.restart_from` must name an earlier step in the same job. The runtime
host does not execute restart semantics yet. This module only records the
accepted meaning in the model.

If a rule needs project data or database state, put that rule in another layer.
This module should stay pure and easy to test.

If a rule can be checked from the document alone, it can live here. If a rule
needs a project, a user, a commit, or a database row, it should live with that
data.

Run this step before saving a new definition. That way bad links, bad ids, and
bad gate rules stop early, while the caller still knows which file field caused
the problem.

This also makes the next step simpler. The next step can read one clear shape
instead of checking many short forms again.

## Development

```sh
turbo check --filter=@shipfox/api-definitions
turbo type --filter=@shipfox/api-definitions
turbo test --filter=@shipfox/api-definitions
```

## License

MIT
