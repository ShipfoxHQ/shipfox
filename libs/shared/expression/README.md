# Expression

CEL checks and run-time evaluation for Shipfox workflow expressions.

## What it does

- **`createWorkflowExpression`**: Checks source text in `syntax` or `typed`
  mode.
- **`WorkflowExpression`**: Stores the CEL tag, source, and check level.
- **`ExpressionTypeEnvironment`**: Lists names and field types for typed checks.
- **`evaluateWorkflowExpression`**: Runs a checked value against caller data.
- **`evaluateWorkflowPredicate`**: Returns `true` only for the boolean `true`.
- **Typed errors**: Reports bad text and run failures with stable error classes.
- **`workflowContextDefinitions`**: Names the v1 workflow contexts (`run`,
  `trigger`, `event`, `inputs`, `job`) and gives each a trust tier and a check
  mode. Known-shape contexts ship a typed environment; open ones use `syntax`.
- **`workflowInterpolationFieldPolicies`**: Says which trust tier each
  interpolatable field accepts, and whether its value needs sanitizing before
  display. Use `workflowInterpolationFieldAcceptsContext` and
  `workflowInterpolationFieldAcceptsTrustTier` to run those checks.

Use this package where workflow code accepts or runs expression text. It keeps
the CEL parser behind a Shipfox API. Other packages do not need to depend on the
vendor parser.

Call it near the place where a person, file, or tool gives us text. If the text
is wrong, stop there and show the error near that field. If the text is good,
save the small value this package returns. Later, pass that value and plain data
back to this package to get the result for one run.

## Installation / Setup

```sh
pnpm add @shipfox/expression
```

## Usage

```ts
import {
  createWorkflowExpression,
  evaluateWorkflowPredicate,
} from '@shipfox/expression';

const expression = createWorkflowExpression({
  source: 'event.conclusion == "success"',
  check: {
    mode: 'typed',
    typeEnvironment: {
      event: {kind: 'object', fields: {conclusion: 'string'}},
    },
  },
});

const passed = evaluateWorkflowPredicate(expression, {
  event: {conclusion: 'success'},
});
```

## Behavior Notes

- Use `syntax` when fields are not known yet.
- Use `typed` when the caller knows the names and field types in scope.
- Treat the `event` and `inputs` contexts as untrusted; the rest are trusted.
  Interpolation field policies decide what untrusted data may reach each field.
- Evaluation is deterministic and has no side effects.
- The caller must pass values that match the checked data shape.
- The evaluator does not read secrets, database rows, events, files, or external
  services.
- The CEL dependency has an ESM patch. Check the patch when upgrading it.

Trigger filters can use `syntax` while integration event payloads are still open.
Gate expressions can use `typed` because their local fields are known.

The stored value does not include vendor ASTs, checked data, protobuf bytes, or
compiled objects. It stores only the CEL tag, source, and check level.

Keep this package free of state. Code that needs a database row, event payload,
secret, file, or network call must load that data first. Then it can pass the
data in one object. This keeps tests small and makes each run easy to reason
about.

## Development

```sh
turbo build --filter=@shipfox/expression
turbo check --filter=@shipfox/expression
turbo type --filter=@shipfox/expression
turbo test --filter=@shipfox/expression
```

## License

MIT
