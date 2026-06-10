# Workflow YAML

This module reads workflow files written in YAML.

## What it does

- **`parseWorkflowYaml(source)`**: Reads YAML source text and returns a
  `WorkflowDocument`.
- **`InvalidWorkflowYamlError`**: Reports bad YAML and roots that are not
  objects.
- **Document checks**: Sends parsed objects to
  `@shipfox/workflow-document`.

Use this module when file text has to become the shared document shape. It is
small on purpose. It reads text, checks that the root is an object, and passes
that object to the document package.

This keeps the first step easy to test. Code that has found a file can call this
part and then pass the result to the next step. Keep new rules out of this part
unless they are about how YAML text is read.

If a rule needs to know about jobs, steps, ids, or run order, put that rule in a
later part. This part should stay easy to read and easy to change.

That keeps the next part clear too.

## Installation / Setup

This code is part of `@shipfox/api-definitions`. It is not a standalone package.

```json
{
  "dependencies": {
    "@shipfox/workflow-document": "workspace:*",
    "js-yaml": "^4.1.0"
  }
}
```

## Usage

```ts
import {parseWorkflowYaml} from '#core/workflow-yaml/index.js';

const document = parseWorkflowYaml(`
name: simple build
jobs:
  build:
    steps:
      - run: npm test
`);

console.log(document.jobs.build.steps[0]?.run);
```

## Behavior Notes

The parser owns only YAML concerns. It does not set defaults. It does not change
job ids. It does not build job graphs. It does not check expressions.

## Development

```sh
turbo check --filter=@shipfox/api-definitions
turbo type --filter=@shipfox/api-definitions
turbo test --filter=@shipfox/api-definitions
```

## License

MIT
