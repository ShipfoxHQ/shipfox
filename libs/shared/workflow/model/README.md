# @shipfox/workflow-model

Workflow meaning for Shipfox workflow tools.

Use this package when code needs meaning, not file syntax. It owns expression
parsing and `WorkflowIR`.

## What it does

- **`parseWorkflowExpression(source)`**: Parses workflow expression text into
  a stable tree.
- **`evaluateWorkflowExpression(expression, context)`**: Evaluates a parsed
  expression against a small context.
- **`evaluateWorkflowPredicate(expression, context)`**: Evaluates an expression
  as a yes or no predicate.
- **Expression diagnostics**: Reports parser errors with stable codes and text
  positions.
- **`normalizeWorkflowDocument(document)`**: Converts a checked
  `WorkflowDocument` into `WorkflowIR`.
- **`WorkflowIR`**: Stores the effective workflow graph, trigger filters, jobs,
  steps, run commands, agent steps, and gates.
- **Model diagnostics**: Reports semantic errors. Examples are unknown
  dependencies, cycles, id collisions, invalid filters, and invalid gates.

## Installation / Setup

```json
{
  "dependencies": {
    "@shipfox/workflow-model": "workspace:*"
  }
}
```

## Usage

```ts
import {evaluateWorkflowPredicate, parseWorkflowExpression} from '@shipfox/workflow-model';

const parsed = parseWorkflowExpression('event.ref == "refs/heads/main"');

if (parsed.valid) {
  const value = evaluateWorkflowPredicate(parsed.expression, {
    event: {ref: 'refs/heads/main'},
  });

  console.log(value);
} else {
  console.log(parsed.diagnostics);
}
```

## Behavior Notes

Expressions are a Shipfox concept. They are not tied to YAML text or platform
database rows.

This package accepts `event.*` references for trigger filters. It also accepts
`step.output.*` references for gate expressions.

The evaluator is small by design. It reads primitive event values. It applies
boolean and comparison operators. It does not call external systems.

Predicate evaluation only treats `true` as a match. A string, number,
`undefined`, or a missing field comparison does not match.

`WorkflowIR` is the shape for workflow meaning. It applies workflow defaults.
It expands `needs`, assigns stable ids, and stores dependency edges once. It
does not include platform fields. Project ids, authors, database rows, and
definition hashes stay outside this package.

Gate support is semantic only here. This package parses `gate.success_if`,
checks `gate.on_failure.restart_from`, and stores the result in `WorkflowIR`.
The runtime package and platform host decide when those gates can execute.

Trigger `with` values become IR `inputs`. That keeps the YAML field name out of
later workflow layers.

## Development

```sh
turbo check --filter=@shipfox/workflow-model
turbo type --filter=@shipfox/workflow-model
turbo test --filter=@shipfox/workflow-model
```

## License

MIT
