---
"@shipfox/expression": minor
---

Adds the `runner` context and the `hashFiles()` function to workflow expressions.

- **`runner` context:** `runner.os` and `runner.arch` are a typed server context available at `step-dispatch`, and `step.if` can read it. The root is no longer in `workflowContextReservedRoots`. A context definition can set `lastSite`, after which `rootsAvailableAt` and `unavailableRootsAt` treat it as unavailable; `runner` sets it to `step-dispatch`. `resolveContextRootLastSite` reads it.
- **`hashFiles()`:** declared for type checks with 1 to 16 string patterns (`HASH_FILES_MAX_PATTERNS`). Planning routes a call to `runner-fill` and records `runnerCall: {function, patterns}` on the deferred segment. `analyzeRunnerCalls` and `referencesRunnerCall` find calls.
- **Plan violations:** `planInterpolationField` reports `runner-call-not-bare`, `runner-call-argument-not-literal`, `runner-call-arity`, `runner-call-in-field`, `runner-call-pattern-invalid`, and `runner-call-pattern-outside-workspace`. Only fields with `acceptsRunnerCalls` (`run`, `env.value`, and `action.with`) accept a call. `validateServerEvaluable` reports `runner-call-in-server-expression`.
