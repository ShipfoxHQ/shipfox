# @shipfox/api-usage-dto

## 27.1.0

### Minor Changes

- e0b7bd1: Carries workflow lineage and name snapshots through job-execution and inference Usage records.

## 27.0.0

### Major Changes

- 0ddc7ef: Removes the `upstream` provider field, provider-reported token aggregates, and per-step attempt breakdowns from public usage surfaces. Model-scoped pricing reference keys now encode `[model]` instead of `[model, upstream]`.

## 22.0.0

### Minor Changes

- 88d28f4: Adds web-search quantities to Usage segments and exports shared per-dialect token-class normalization.

## 21.2.0

### Minor Changes

- 1ba23be: Add the Usage context with durable job execution and inference segment records.
