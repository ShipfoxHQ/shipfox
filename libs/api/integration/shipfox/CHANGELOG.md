# @shipfox/api-integration-shipfox

## 34.0.0

### Minor Changes

- b9a53b2: Adds `status_reason`, `status_reason_message`, and `outputs` to the run overview attempt. The `shipfox` provider's `get_workflow_run` tool returns them on its attempt, and the agent-access `get_workflow_run` tool returns them on the run.
- ac3561b: Names what is missing in MCP tool errors when a run cannot start. `fire_manual_trigger` and `create_dev_run` include the variable key and where it is read, the trigger secret key, runner labels and size figures in the error message and details. `start_workflow_run` does the same. The `interpolation-unresolvable` error from Triggers now carries the optional `variableKey`, `jobKey` and `step`.

### Patch Changes

- ebe3ac1: Adds the Shipfox lifecycle event names, payload schemas, empty event catalog, and exported built-in integration connection ID contract.
- b1cc902: Shipfox read tools now work as `tool:` steps, including `get_step_logs` with `failed_only`.
- Updated dependencies [e99aa97]
- Updated dependencies [ba1aff7]
- Updated dependencies [3b3e25c]
- Updated dependencies [fb79732]
- Updated dependencies [027e401]
- Updated dependencies [2e5a311]
- Updated dependencies [f05ecde]
- Updated dependencies [b9a53b2]
- Updated dependencies [a9e85c1]
- Updated dependencies [a73e712]
- Updated dependencies [8872f36]
- Updated dependencies [fc455ac]
- Updated dependencies [6b01f3d]
- Updated dependencies [ac3561b]
- Updated dependencies [af3b91f]
- Updated dependencies [c8e0869]
- Updated dependencies [3869c1d]
- Updated dependencies [a15e118]
- Updated dependencies [4aad893]
- Updated dependencies [6c0d6bd]
- Updated dependencies [c6f2ae3]
- Updated dependencies [fafbe84]
- Updated dependencies [737c625]
- Updated dependencies [d77a8c4]
- Updated dependencies [507915a]
- Updated dependencies [3aa5d7a]
- Updated dependencies [ebe3ac1]
- Updated dependencies [94e77bc]
- Updated dependencies [dbe45d5]
- Updated dependencies [e2e561c]
- Updated dependencies [dd20040]
- Updated dependencies [daf0208]
- Updated dependencies [00dd046]
- Updated dependencies [7d9b08a]
- Updated dependencies [82f2480]
- Updated dependencies [ffffc16]
- Updated dependencies [6b2a308]
  - @shipfox/api-secrets-dto@34.0.0
  - @shipfox/api-workflows-dto@34.0.0
  - @shipfox/api-definitions-dto@34.0.0
  - @shipfox/api-integration-shipfox-dto@34.0.0
  - @shipfox/api-triggers-dto@34.0.0
  - @shipfox/api-integration-spi@4.4.0
  - @shipfox/api-logs-dto@34.0.0
  - @shipfox/node-drizzle@0.3.7

## 33.0.0

### Patch Changes

- @shipfox/api-workflows-dto@33.0.0
- @shipfox/api-triggers-dto@33.0.0

## 32.2.0

### Patch Changes

- @shipfox/api-definitions-dto@32.2.0
- @shipfox/api-workflows-dto@32.2.0
- @shipfox/api-triggers-dto@32.2.0

## 32.1.0

### Patch Changes

- @shipfox/api-workflows-dto@32.1.0
- @shipfox/api-triggers-dto@32.1.0

## 32.0.0

### Patch Changes

- Updated dependencies [212c6b6]
  - @shipfox/api-workflows-dto@32.0.0
  - @shipfox/api-triggers-dto@32.0.0

## 31.0.0

### Minor Changes

- 8db3f51: Adds reference-based secret inputs to `start_workflow_run` for tool steps.

### Patch Changes

- Updated dependencies [9b671f9]
- Updated dependencies [bcd9232]
- Updated dependencies [bab2786]
- Updated dependencies [c5c7fa3]
- Updated dependencies [9e170c7]
- Updated dependencies [bcd9232]
- Updated dependencies [85f3d47]
  - @shipfox/api-triggers-dto@31.0.0
  - @shipfox/api-workflows-dto@31.0.0
  - @shipfox/api-secrets-dto@31.0.0
  - @shipfox/api-definitions-dto@31.0.0
  - @shipfox/api-integration-spi@4.3.3

## 30.0.0

### Patch Changes

- Updated dependencies [0d3c668]
- Updated dependencies [b734fcf]
  - @shipfox/api-integration-spi@4.3.2
  - @shipfox/api-workflows-dto@30.0.0
  - @shipfox/api-triggers-dto@30.0.0
  - @shipfox/api-definitions-dto@30.0.0

## 29.1.0

### Patch Changes

- @shipfox/api-workflows-dto@29.1.0
- @shipfox/api-triggers-dto@29.1.0

## 29.0.0

### Minor Changes

- a859808: Adds the built-in Shipfox workflow tool provider and its `start_workflow_run` tool.
- 8e74f71: Adds read-only Shipfox tools for bounded step logs and paged run annotations.
- 4de2dde: Adds read tools for workspace projects, workflow definitions, and workflow runs.

### Patch Changes

- Updated dependencies [a859808]
- Updated dependencies [e7a8fe4]
- Updated dependencies [f4f1f10]
- Updated dependencies [8e74f71]
  - @shipfox/api-integration-spi@4.3.1
  - @shipfox/api-workflows-dto@29.0.0
  - @shipfox/node-drizzle@0.3.6
  - @shipfox/api-logs-dto@29.0.0
  - @shipfox/annotations-dto@29.0.0
  - @shipfox/api-triggers-dto@29.0.0
  - @shipfox/api-definitions-dto@29.0.0
