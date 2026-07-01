# @shipfox/expression

## 1.1.0

### Minor Changes

- 8f51daf: Adds workflow template parsing with expression segments and conservative CEL root extraction for downstream interpolation checks.
- e689abf: Adds the v1 workflow context registry and interpolation field policies for typed, trust-tiered workflow interpolation.
- cdf8989: Adds shared CEL expression checks and evaluation behind Shipfox-owned APIs.
- 1127ba2: Adds safe run-command interpolation by hoisting resolved values into generated environment variables.
- 998eba3: Adds phase-aware workflow context metadata, availability predicates, and creation-phase workflow context assembly for runtime materialization.
- 9d3b43a: Adds expected result type validation for typed workflow expressions.
- ef1e917: Adds listening-job authoring fields and trusted execution context validation for listening jobs.
  Separates workflow identifiers so internal rows use UUID `id`, authored workflow/job/step
  references use `key`, and UI labels use `name`.
- ad6056b: Adds workflow template resolution with string coercion, missing-path diagnostics, and typed evaluation failures.
