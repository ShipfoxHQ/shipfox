# Expression Evaluator

Shared CEL evaluation for validated Shipfox expressions.

## What it does

- `evaluateWorkflowExpression` runs a validated `WorkflowExpression` against supplied values.
- `evaluateWorkflowPredicate` returns `true` only when the expression result is the boolean `true`.
- `WorkflowExpressionEvaluationError` wraps evaluation failures from the CEL engine.

Use this package after an expression has already been accepted by `@shipfox/expression-language`. The caller supplies all values. The evaluator does not fetch data.

Think of this as the last step. The text was checked before. Now the caller gives the values for this run, and this part returns a value. It should be easy to test because it only uses what the caller gives it.

## Installation

```sh
pnpm add @shipfox/expression-evaluator
```

## Usage

```ts
import {createWorkflowExpression} from '@shipfox/expression-language';
import {evaluateWorkflowPredicate} from '@shipfox/expression-evaluator';

const expression = createWorkflowExpression({
  source: 'event.conclusion == "success"',
  typeEnvironment: {
    event: {kind: 'object', fields: {conclusion: 'string'}},
  },
});

const passed = evaluateWorkflowPredicate(expression, {
  event: {conclusion: 'success'},
});
```

## Behavior Notes

- Evaluation is deterministic and side-effect-free.
- The caller must pass values that match the type-checked context.
- The evaluator does not read secrets, database rows, events, files, or external services.
- The CEL engine stays hidden behind this package.

Do not put side effects here. Do not read state here. Code that needs a row, file, secret, or event must get it before calling this package.

When you add a new call site, build the data first. Then pass that data in one plain object. A test should be able to pass the same object and get the same answer.

This keeps run logic clear and makes each test small.

If the answer is wrong, change the data you pass in or change the checked text before this step.

Keep this part small and easy to test.

## Development

```sh
turbo build --filter=@shipfox/expression-evaluator
turbo check --filter=@shipfox/expression-evaluator
turbo type --filter=@shipfox/expression-evaluator
turbo test --filter=@shipfox/expression-evaluator
```

## License

MIT
