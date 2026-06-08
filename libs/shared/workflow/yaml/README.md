# @shipfox/workflow-yaml

YAML parsing helpers for Shipfox workflow documents.

Use this package when code has a YAML file and needs the same object shape that
other workflow tools use. The result is easy to pass to the next layer.

The package is small by design. It reads text and gives back data or errors.
Callers can show the errors to a user or stop before the next step.

## What it does

- **`parseWorkflowYaml(source)`**: Parses YAML text into a checked
  `WorkflowDocument`.
- **YAML diagnostics**: Reports syntax and root shape errors with stable
  codes.
- **Document diagnostics**: Reuses `@shipfox/workflow-document` diagnostics for
  parsed objects with the wrong shape.

## Installation / Setup

```json
{
  "dependencies": {
    "@shipfox/workflow-yaml": "workspace:*"
  }
}
```

## Usage

```ts
import {parseWorkflowYaml} from '@shipfox/workflow-yaml';

const result = parseWorkflowYaml(`
name: simple build
jobs:
  build:
    steps:
      - run: npm test
`);

if (result.valid) {
  console.log(result.document.jobs.build.steps[0]?.run);
} else {
  console.log(result.diagnostics);
}
```

## Behavior Notes

This package owns YAML syntax and source parsing only. It does not normalize a
workflow. It does not check dependency graphs. It does not run workflows.

Platform definition code will use this package for its YAML parse step. Runtime
code should consume normalized workflow data instead.

Keep new rules out of this package when they are not about YAML text. Put graph
rules, defaults, and runtime choices in later workflow layers.

This split keeps each part simple. One part reads text. One part checks meaning.
One part decides what can run.

Diagnostic codes, paths, and details are stable. Messages are for people and may
change when parser wording changes.

## Development

```sh
turbo check --filter=@shipfox/workflow-yaml
turbo type --filter=@shipfox/workflow-yaml
turbo test --filter=@shipfox/workflow-yaml
```

## License

MIT
