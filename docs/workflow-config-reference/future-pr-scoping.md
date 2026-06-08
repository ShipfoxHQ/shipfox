# Workflow Config Follow-Up PR Scoping

This document keeps follow-up work for the external workflow config reference small and reviewable.

## Current PR Boundary

The current `@shipfox/workflow-config` PR owns only the external syntactic workflow config shape, its Zod schema, its exported JSON Schema artifact, and focused tests.

It intentionally does not wire the schema into definitions, workflows, triggers, runners, persistence, Temporal orchestration, or runtime behavior.

## Recommended Follow-Up Order

### 1. Definitions Consumption

Wire `libs/api/definitions` to consume `@shipfox/workflow-config` at the config boundary.

Keep definitions-owned parsing, defaults, semantic checks, and internal entities in `libs/api/definitions`.

### 2. Definitions Semantic Validation

Add definitions-owned semantic validation after the shared config boundary is adopted.

Examples:

- job names referenced by `needs` exist;
- dependency cycles are rejected;
- trigger defaults and trigger-source rules are applied;
- manual trigger uniqueness remains definitions-owned if it depends on definitions behavior;
- diagnostics remain stable at the definitions/API edge.

### 3. Config Evolution: Gates

Introduce step gates as a dedicated config-evolution PR, not as a side effect of the initial shared schema.

The future surface should include:

```yaml
steps:
  - id: build
    run: npm run build
    gate:
      success_if: exit_code == 0
      on_failure:
        restart_from: install
        output: "Build failed"
```

Scope for that PR:

- add `gate` to the external config schema;
- add `success_if` as a string expression field;
- add `on_failure.restart_from`;
- add `on_failure.output`;
- add examples and JSON Schema snapshot updates;
- keep expression parsing and runtime behavior out of scope unless explicitly planned.

### 4. Expression Model

Add expression parsing and evaluation as a separate PR after the string-bearing config fields are accepted.

Candidate fields:

- trigger `filter`;
- gate `success_if`;
- interpolation inside failure output strings.

### 5. Workflow Runtime Integration

Touch `libs/api/workflows`, Temporal orchestration, runners, and runtime behavior only after definitions owns a stable internal representation.

Do not introduce a shared internal `WorkflowIR` package unless module owners agree that it solves a concrete ownership problem.
