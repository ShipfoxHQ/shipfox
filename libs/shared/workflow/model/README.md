# @shipfox/workflow-model

Workflow meaning for Shipfox workflow tools.

Use this package when code needs meaning, not file syntax. This first slice owns
expression parsing and checks. `WorkflowIR` will live here in the next slice.

## What it does

- **`parseWorkflowExpression(source)`**: Parses workflow expression text into
  a stable tree.
- **`evaluateWorkflowExpression(expression, context)`**: Evaluates a parsed
  expression against a small context.
- **`evaluateWorkflowPredicate(expression, context)`**: Evaluates an expression
  as a yes or no predicate.
- **Expression diagnostics**: Reports parser errors with stable codes and text
  positions.

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

This package only accepts `event.*` references for now. Step output references
will be added with gate semantics.

The evaluator is small by design. It reads primitive event values and applies
boolean and comparison operators. It does not call external systems.

Predicate evaluation only treats `true` as a match. A string, number,
`undefined`, or a missing field comparison does not match.

## Development

```sh
turbo check --filter=@shipfox/workflow-model
turbo type --filter=@shipfox/workflow-model
turbo test --filter=@shipfox/workflow-model
```

## License

MIT
