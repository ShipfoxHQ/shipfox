# @shipfox/api-usage-dto

## 34.0.0

### Major Changes

- 530d00f: Credentials and usage can name a conversation instead of a step attempt, so inference no longer requires a run.

  - **Credentials:** `resolveRuntimeCredentials` and `ManagedModelProvider.resolveCredentials` take a `subject` in place of `runId`, `stepAttemptId`, and `jobIdentity`. `InferenceSubject` has the kinds `step_attempt` and `conversation`, and a conversation names its `agentKey`. A composing application's managed provider must read the IDs from `subject`.
  - **Usage:** `InferenceSegmentInputDto`, `InferenceSegmentUsageDto`, and `usage.inference_segment.recorded` are unions of a step segment, with the IDs down to the step attempt, and a conversation segment, with a `conversationId` and the `agentKey` of its agent, so usage can be measured per agent. The schemas and a database check reject anything else, and a consumer must handle a segment with no run. `StepInferenceSegmentInputDto` names the step variant, and `inferenceSegmentStepIdentity` returns the run identity of a stored row. Conversation segments skip the job execution projection check, and their events order on the conversation ID. The run and job execution routes don't change.
  - **Project ownership:** `createUsageModule` takes a `projects` client. Usage confirms that a conversation segment's project isn't in another workspace before recording it, and a mismatch fails the batch.
  - **Agent:** `@shipfox/api-agent` exports `builtInAgentConfigInput`, which `resolveAgentConfig` takes in place of a step. `renewal` now covers any later credential for admitted work, so the model and summary calls after a turn's first model call skip the availability check.

### Minor Changes

- 67c51ec: Usage records the stored cache bytes of each project once an hour. The Usage contract gains `recordStorageSamples`, which returns the counts of recorded samples and duplicates, and the `listStorageSamples` replay cursor. Usage publishes `usage.storage_sample.recorded` for each new sample. A sample holds quantities only. The Cache module takes a `usage` client and samples `ready` entries at minute 5 of every hour. It records one sample per project, keyed by project and clock hour, so a repeated run records nothing twice.

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
