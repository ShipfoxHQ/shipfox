# @shipfox/e2e-setup-agent

## 34.0.0

### Major Changes

- 530d00f: Credentials and usage can name a conversation instead of a step attempt, so inference no longer requires a run.

  - **Credentials:** `resolveRuntimeCredentials` and `ManagedModelProvider.resolveCredentials` take a `subject` in place of `runId`, `stepAttemptId`, and `jobIdentity`. `InferenceSubject` has the kinds `step_attempt` and `conversation`, and a conversation names its `agentKey`. A composing application's managed provider must read the IDs from `subject`.
  - **Usage:** `InferenceSegmentInputDto`, `InferenceSegmentUsageDto`, and `usage.inference_segment.recorded` are unions of a step segment, with the IDs down to the step attempt, and a conversation segment, with a `conversationId` and the `agentKey` of its agent, so usage can be measured per agent. The schemas and a database check reject anything else, and a consumer must handle a segment with no run. `StepInferenceSegmentInputDto` names the step variant, and `inferenceSegmentStepIdentity` returns the run identity of a stored row. Conversation segments skip the job execution projection check, and their events order on the conversation ID. The run and job execution routes don't change.
  - **Project ownership:** `createUsageModule` takes a `projects` client. Usage confirms that a conversation segment's project isn't in another workspace before recording it, and a mismatch fails the batch.
  - **Agent:** `@shipfox/api-agent` exports `builtInAgentConfigInput`, which `resolveAgentConfig` takes in place of a step. `renewal` now covers any later credential for admitted work, so the model and summary calls after a turn's first model call skip the availability check.

### Minor Changes

- e5eff24: Adds a Jam fake to the E2E harness, a `createJamConnection` setup helper, and an `image_content_present` request assertion for fake model provider scripts.
- b42874e: Publishes the E2E setup packages and the workflows observation, and exports `parseSetCookie` from `@shipfox/e2e-setup-auth`.

### Patch Changes

- Updated dependencies [2062ec8]
- Updated dependencies [04bf72a]
- Updated dependencies [4227bda]
- Updated dependencies [7d20d04]
- Updated dependencies [610ab29]
- Updated dependencies [dc2bd62]
- Updated dependencies [3f1363c]
- Updated dependencies [8937e15]
- Updated dependencies [1f218c4]
- Updated dependencies [68d6cd6]
- Updated dependencies [c10e4c4]
- Updated dependencies [18678ea]
- Updated dependencies [2339c1b]
- Updated dependencies [8a4f3d8]
- Updated dependencies [530d00f]
- Updated dependencies [a99c11b]
- Updated dependencies [e560f69]
- Updated dependencies [1a50666]
- Updated dependencies [3fe51c3]
- Updated dependencies [a15e118]
- Updated dependencies [25fd5a8]
- Updated dependencies [3d329a9]
- Updated dependencies [f5c364b]
- Updated dependencies [3f1363c]
- Updated dependencies [d2a2168]
- Updated dependencies [dd20040]
- Updated dependencies [70e6983]
  - @shipfox/api-agent-dto@34.0.0
