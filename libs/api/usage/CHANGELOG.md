# @shipfox/api-usage

## 28.0.0

### Patch Changes

- Updated dependencies [48ec879]
- Updated dependencies [e8f0212]
- Updated dependencies [d62e17e]
- Updated dependencies [7067bc3]
  - @shipfox/api-runners-dto@28.0.0
  - @shipfox/api-workflows-dto@28.0.0

## 27.2.0

### Patch Changes

- Updated dependencies [6ad8c2e]
- Updated dependencies [6bc8256]
- Updated dependencies [45cf692]
  - @shipfox/api-workflows-dto@27.2.0
  - @shipfox/api-runners-dto@27.2.0

## 27.1.0

### Minor Changes

- e0b7bd1: Carries workflow lineage and name snapshots through job-execution and inference Usage records.

### Patch Changes

- Updated dependencies [e0b7bd1]
  - @shipfox/api-workflows-dto@27.1.0
  - @shipfox/api-usage-dto@27.1.0

## 27.0.0

### Major Changes

- 0ddc7ef: Removes the `upstream` provider field, provider-reported token aggregates, and per-step attempt breakdowns from public usage surfaces. Model-scoped pricing reference keys now encode `[model]` instead of `[model, upstream]`.

### Patch Changes

- Updated dependencies [0ddc7ef]
  - @shipfox/api-usage-dto@27.0.0
  - @shipfox/api-workflows-dto@27.0.0

## 26.1.0

### Patch Changes

- Updated dependencies [cb99d51]
  - @shipfox/api-workflows-dto@26.1.0
  - @shipfox/node-fastify@0.4.6
  - @shipfox/node-module@1.1.1
  - @shipfox/node-temporal@0.5.2
  - @shipfox/api-auth-context@26.1.0

## 26.0.0

### Patch Changes

- Updated dependencies [da717b1]
- Updated dependencies [5cb4279]
- Updated dependencies [fb73bca]
- Updated dependencies [8229356]
- Updated dependencies [aafce80]
  - @shipfox/api-workflows-dto@26.0.0
  - @shipfox/api-auth-context@26.0.0
  - @shipfox/node-module@1.1.0

## 25.0.0

### Patch Changes

- Updated dependencies [00e2ce4]
- Updated dependencies [bba82ae]
- Updated dependencies [9e8b007]
  - @shipfox/api-runners-dto@25.0.0
  - @shipfox/api-workflows-dto@25.0.0
  - @shipfox/api-auth-context@25.0.0

## 24.2.0

### Patch Changes

- Updated dependencies [011d9ec]
- Updated dependencies [3cc2ffb]
- Updated dependencies [6100626]
  - @shipfox/api-workflows-dto@24.2.0
  - @shipfox/api-runners-dto@24.2.0

## 24.1.1

### Patch Changes

- @shipfox/api-workflows-dto@24.1.1

## 24.1.0

### Patch Changes

- Updated dependencies [c730a68]
- Updated dependencies [dd01977]
- Updated dependencies [cdc9dfe]
  - @shipfox/api-workflows-dto@24.1.0
  - @shipfox/config@1.3.0
  - @shipfox/api-auth-context@24.1.0
  - @shipfox/node-fastify@0.4.5
  - @shipfox/node-opentelemetry@0.6.6
  - @shipfox/node-postgres@0.5.2
  - @shipfox/node-temporal@0.5.1
  - @shipfox/node-module@1.0.11
  - @shipfox/node-outbox@0.2.7

## 24.0.0

### Patch Changes

- @shipfox/api-auth-context@24.0.0
- @shipfox/api-workflows-dto@24.0.0

## 23.2.0

### Patch Changes

- @shipfox/api-auth-context@23.2.0

## 23.1.0

### Patch Changes

- @shipfox/api-auth-context@23.1.0

## 23.0.0

### Patch Changes

- Updated dependencies [7fed218]
- Updated dependencies [bd5acd2]
  - @shipfox/api-auth-context@23.0.0
  - @shipfox/api-workflows-dto@23.0.0
  - @shipfox/api-runners-dto@21.1.0
  - @shipfox/api-usage-dto@22.0.0
  - @shipfox/config@1.2.4
  - @shipfox/inter-module@0.2.3
  - @shipfox/runner-labels@0.2.1
  - @shipfox/node-drizzle@0.3.5
  - @shipfox/node-fastify@0.4.4
  - @shipfox/node-module@1.0.10
  - @shipfox/node-opentelemetry@0.6.5
  - @shipfox/node-outbox@0.2.7
  - @shipfox/node-postgres@0.5.1
  - @shipfox/node-temporal@0.5.0

## 22.0.0

### Minor Changes

- 88d28f4: Adds web-search quantities to Usage segments and exports shared per-dialect token-class normalization.

### Patch Changes

- Updated dependencies [c392dfb]
- Updated dependencies [e390533]
- Updated dependencies [88d28f4]
  - @shipfox/api-workflows-dto@22.0.0
  - @shipfox/api-usage-dto@22.0.0

## 21.2.0

### Minor Changes

- 1ba23be: Add the Usage context with durable job execution and inference segment records.

### Patch Changes

- Updated dependencies [1ba23be]
- Updated dependencies [0745878]
- Updated dependencies [1f2c634]
- Updated dependencies [12cc22e]
- Updated dependencies [8407bd1]
  - @shipfox/api-usage-dto@21.2.0
  - @shipfox/node-module@1.0.10
  - @shipfox/node-temporal@0.5.0
  - @shipfox/api-workflows-dto@21.2.0
