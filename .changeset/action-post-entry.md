---
"@shipfox/actions": minor
"@shipfox/workflow-document": minor
"@shipfox/api-definitions": minor
"@shipfox/api-definitions-dto": minor
"@shipfox/registry-format": minor
---

An action can declare a `post` entry in `action.yml`. Shipfox accepts it and does not run it yet.

- **Manifest:** `post` follows the path rules of `main` and must differ from it. `post_failure` is `warn` (the default) or `fail`, and needs `post`. A repository action must contain the `post` file.
- **Workflow model:** an action step carries `post` and `postFailure`. Models stored before this change omit both.
- **SDK:** `defineAction` handlers receive `state.set(name, value)` and `state.get(name)`, backed by the `SHIPFOX_STATE` file. `context` gains `phase`, and `execution` and `main` for a post. `setOutput` throws in a post.
- **Testing:** `runAction` accepts `phase`, `state`, `executionFailed`, and `mainStatus`, and returns the `state` after the run.
- **Registry bumps:** `computeActionBump` returns `minor` when `post` is added or removed, `major` when `post_failure` goes from `warn` to `fail`, and `patch` from `fail` to `warn`.
