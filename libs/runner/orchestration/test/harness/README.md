# Runner workflow test harness

`createFakeProtocol(spec)` returns an in-memory `RunnerProtocol` backed by
`WorkflowStateMachine`. It lets the workflow tests drive the **real** orchestration
and the **real** execution layer (real subprocess, real per-job workspace) through a
whole job, faking only the network.

## What the fake proves

- The assembled control flow: claim, setup, run steps, report, next, done.
- The named error branches: lease vanished on next (`failNextStep`), stale report
  (`failReport`), heartbeat cancel (`cancelOnHeartbeat`), heartbeat orphan
  (`finalizeOnHeartbeat`), and transient claim failure (`failClaims`).
- Report payload shape: bodies are validated through the real `reportStepBodySchema`,
  so a malformed runner report fails here too.
- The setup step's real checkout: `spec.checkout` is served from `requestCheckoutToken`,
  and the integration suite points it at a local `file://` git remote, so setup runs a
  real shallow clone rather than a mock.
- Run-step log capture: run steps stream real captured output through the real
  `createStepLogStream` pipeline; the fake's `appendStepLogs` commits every chunk so the
  uploader advances and the stream drains.

## What the fake does NOT prove

This is a control-flow test double, not a server replacement. It is hand-written and
has **no drift guard** against the real API. It deliberately does not model:

- gate evaluation, restart / rewind, or multi-attempt history;
- outbox finalization, runner-token scoping, or running-job lease rows;
- DB transactions / concurrency;
- the `ky` wire layer (retry, status codes, JSON / Zod parsing on the wire). That
  stays covered by `libs/runner/protocol/src/protocol-client.test.ts`.

If `libs/api/workflows/src/core/job-execution.ts` or `step-transition/*` change, this
fake can drift while these tests stay green. The runner-vs-server contract is only
proven by a real-API E2E slice, which is intentionally out of scope here.

## Known gaps (follow-up)

The checkout step was integrated minimally; these are not yet covered here and need
finishing:

- **Checkout failure modes** (auth denied, provider unavailable, clone failure) are
  exercised only by `libs/runner/execution/src/core/setup-step.test.ts`, not end to end
  through the assembled runner. Add `cancelOnHeartbeat`-style spec flags to drive a
  failing/credentialed checkout through a whole job.
- **Heartbeat-cancellation timing**: `cancels an in-flight job…` and `aborts an orphaned
  job…` use a 250ms heartbeat so the first tick lands after setup's real clone. That
  couples the tests to local-clone duration; a slow host could still race them. The
  robust fix is to make setup completion observable so the cancel is sequenced on job
  state instead of wall-clock.
- **Agent steps**: the state machine models only `setup` and `run` steps, so the
  `step.type === 'agent'` dispatch (`executeAgentStep`) is covered only by the step-loop
  unit tests, not driven through a whole job here. Add an agent step kind to `WorkflowSpec`
  to exercise it end to end.
- **Log append failure paths**: the fake's `appendStepLogs` always commits. The
  offset-gap (409), capped, and stopped (terminal 4xx) outcomes stay covered by
  `libs/runner/protocol/src/protocol-client.test.ts`, not through the assembled uploader.
