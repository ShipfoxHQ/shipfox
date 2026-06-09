# Expression Language

Shared CEL parsing and type checks for Shipfox expressions.

## What it does

- `createWorkflowExpression` checks CEL source with a type environment.
- `WorkflowExpression` stores `{language: 'cel', source}` with a branded source string.
- `InvalidWorkflowExpressionError` reports parse and type errors.
- `ExpressionTypeEnvironment` describes the names and field types visible to an expression.

Use this package before raw expression text enters a workflow model. It keeps CEL behind a Shipfox API so the rest of the code does not depend on a vendor package.

Think of this as a check at the edge. A user or tool gives some text. This part says if the text can be used in the place where it was found. If the text is good, later code can keep it. If the text is bad, stop and show the reason near the field.

## Installation

```sh
pnpm add @shipfox/expression-language
```

## Usage

```ts
import {createWorkflowExpression} from '@shipfox/expression-language';

const expression = createWorkflowExpression({
  source: 'event.conclusion == "success"',
  typeEnvironment: {
    event: {
      kind: 'object',
      fields: {
        conclusion: 'string',
      },
    },
  },
});

expression; // {language: "cel", source: "event.conclusion == \"success\""}
```

## Context

CEL is the selected expression language. The accepted stored shape is only the language tag and source string. Do not store vendor ASTs, checked data, protobuf bytes, or compiled objects.

Expression contexts are lexical. The caller builds the type environment from the place where the expression appears in the workflow tree.

Root bindings can include `trigger`, `inputs`, `env`, and `run`. Event-triggered filters can add `event`. Step, job, loop, and parallel bindings are available only when they are in scope and upstream. Secrets are not expression bindings.

Type environments come from event schemas, workflow inputs, step output schemas, loop and parallel types, and run metadata. This package checks the source against that environment. It does not know about projects, users, the database, or the runtime.

The place in the tree matters. A name that is in scope in one place may be out of scope in another place. Build the list of names first, then call this package. Keep that rule simple so a reader can tell why a name is allowed.

## Behavior Notes

- The parser trims source before storing it.
- Bad source throws `InvalidWorkflowExpressionError`.
- The package uses `@gresb/cel-javascript` internally.
- The CEL dependency is patched for ESM packaging; re-check the patch when upgrading it.
- Raw strings become branded only after this package accepts them.

Do not pass user text around as if it were safe. Make it safe here first. That keeps later code small and makes tests easier to read.

When you add a new place that can use this text, start by asking what names should be visible there. Add those names to the type map, add a test for a good field, and add a test for a bad field.

This keeps the rule clear for both the next person and the next test.

Keep it easy to follow.

Keep it small.

This helps the team find the right place to make a change.

## Development

```sh
turbo build --filter=@shipfox/expression-language
turbo check --filter=@shipfox/expression-language
turbo type --filter=@shipfox/expression-language
turbo test --filter=@shipfox/expression-language
```

## License

MIT
