# @shipfox/api-definitions

API module for workflow definitions.

Use this package when the API reads workflow YAML. It stores the platform spec.
It sends definition events.

## What it does

- **Definition validation**: Parses YAML and keeps `WorkflowSpec`.
- **Semantic checks**: Uses workflow model packages.
- **Definition storage**: Stores project, source, ref, SHA, path, and hash data.
- **Definition events**: Sends resolved and deleted events through the outbox.
- **Definition sync**: Syncs VCS-backed files with Temporal.

## Installation / Setup

```json
{
  "dependencies": {
    "@shipfox/api-definitions": "workspace:*"
  }
}
```

## Usage

```ts
import {parseDefinition} from '@shipfox/api-definitions';

const spec = parseDefinition(`
name: simple build
jobs:
  build:
    steps:
      - run: npm test
`);

console.log(spec.name);
```

## Routes / API / Data Model

The module adds definition routes to the API. The validation route accepts YAML.
It returns a checked spec or errors.

The database tables use the `definitions_` prefix:

| Table | Purpose |
| --- | --- |
| `definitions_workflow_definitions` | Stores specs and source data. |
| `definitions_sync_states` | Tracks sync state for a project source. |
| `definitions_outbox` | Stores module events for publisher dispatch. |

## Behavior Notes

The platform still stores `WorkflowSpec`. Validation adapts it into a strict
workflow document. Semantic checks run after that.

This keeps legacy fields such as trigger `on` in the stored spec. New workflow
packages own syntax and semantic checks.

Semantic validation is stricter than the old DAG-only check. Stable id
collisions and invalid trigger filter expressions now fail validation.

## Development

```sh
turbo check --filter=@shipfox/api-definitions
turbo type --filter=@shipfox/api-definitions
turbo test --filter=@shipfox/api-definitions
```

Tests use PostgreSQL. Start local services with `docker compose up -d` before
running the full package test target.

## License

MIT
