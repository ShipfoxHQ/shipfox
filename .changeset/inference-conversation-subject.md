---
"@shipfox/api-agent-dto": major
"@shipfox/api-usage-dto": major
"@shipfox/api-agent": major
"@shipfox/api-usage": major
"@shipfox/api-server": patch
"@shipfox/api-workflows": patch
"@shipfox/e2e-setup-agent": major
---

Credentials and usage can name a conversation instead of a step attempt, so inference no longer requires a run.

- **Credentials:** `resolveRuntimeCredentials` and `ManagedModelProvider.resolveCredentials` take a `subject` in place of `runId`, `stepAttemptId`, and `jobIdentity`. `InferenceSubject` has the kinds `step_attempt` and `conversation`. A composing application's managed provider must read the IDs from `subject`.
- **Usage:** `InferenceSegmentInputDto`, `InferenceSegmentUsageDto`, and `usage.inference_segment.recorded` are unions of a step segment, with the IDs down to the step attempt, and a conversation segment, with a `conversationId`. The schemas and a database check reject anything else, and a consumer must handle a segment with no run. `StepInferenceSegmentInputDto` names the step variant, and `inferenceSegmentStepIdentity` returns the run identity of a stored row. Conversation segments skip the job execution projection check, and their events order on the conversation ID. The run and job execution routes don't change.
- **Project ownership:** `createUsageModule` takes a `projects` client. Usage confirms that a conversation segment's project isn't in another workspace before recording it, and a mismatch fails the batch.
- **Agent:** `@shipfox/api-agent` exports `builtInAgentConfigInput`, which `resolveAgentConfig` takes in place of a step. `renewal` now covers any later credential for admitted work, so the model calls of a turn after its first skip the availability check.
