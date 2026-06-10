# Expression Language

Shared CEL parsing and type checks for Shipfox workflow expressions.

## What it does

- **`createWorkflowExpression`**: Checks CEL source in either `syntax` or
  `typed` mode and returns a stored Shipfox expression.
- **`WorkflowExpression`**: Stores the CEL language tag, the checked source, and
  the check level that was applied.
- **`ExpressionTypeEnvironment`**: Describes the names and field types visible to
  a typed expression.
- **`InvalidWorkflowExpressionError`**: Reports parse and type-check failures.

Use this package before raw expression text enters a workflow model. It keeps
CEL behind a Shipfox API, so other packages do not depend on a vendor parser.

## Installation / Setup

```sh
pnpm add @shipfox/expression-language
```

## Usage

```ts
import {createWorkflowExpression} from '@shipfox/expression-language';

const triggerFilter = createWorkflowExpression({
  source: 'event.ref == "refs/heads/main"',
  check: {mode: 'syntax'},
});

const stepGate = createWorkflowExpression({
  source: 'exit_code == 0',
  check: {
    mode: 'typed',
    typeEnvironment: {
      exit_code: 'int',
    },
  },
});

console.log(triggerFilter.check); // "syntax"
console.log(stepGate.check); // "typed"
```

## Behavior Notes

- Use `syntax` when CEL syntax should be checked but fields are not known yet.
- Use `typed` when the caller knows the names and field types in scope.
- The parser trims source before storing it.
- Bad source throws `InvalidWorkflowExpressionError`.
- The package uses `@gresb/cel-javascript` internally.
- The CEL dependency is patched for ESM packaging; re-check the patch when
  upgrading it.

Trigger filters can use `syntax` while integration event payloads are still
open. Gate expressions can use `typed` because their local fields are known.

Choose the mode from the place where the text appears. If the caller does not
know the event shape yet, use `syntax`. This checks that the text is valid CEL
and saves it with that mark. It does not check names or fields.

If the caller knows the names that are in scope, use `typed`. Pass those names
and their field types in `typeEnvironment`. This lets the package catch a bad
field name before the workflow is saved.

Most call sites need one simple choice. If data can come from many outside
services, and the code cannot know every part of it, use `syntax`. If the data
shape is set by our code and can be put in a small map, use `typed`. A bad value
at run time can still fail later. This package checks the text before save time.

Tests should stay close to the rule that owns the text. Give the function a good
case and a bad case. The same input should give the same result each time. This
code should not read files, call the network, or load data from a store.

When a new area needs this feature, start with the user text and the values that
can be seen from that place. Pick the mode first. Add only the values that are
known there. Then add a test that proves a wrong path is caught or left open on
purpose.

This keeps the first save fast and clear. It also lets later code show a clear
message near the part that a person wrote.

Keep the call small. Put the rule near the place that owns it, and make the test
read like the case a user would send. Keep it clear.

The stored expression does not include vendor ASTs, checked data, protobuf bytes,
or compiled objects. It stores only the CEL language tag, checked source, and the
check level.

## Development

```sh
turbo build --filter=@shipfox/expression-language
turbo check --filter=@shipfox/expression-language
turbo type --filter=@shipfox/expression-language
turbo test --filter=@shipfox/expression-language
```

## License

MIT
