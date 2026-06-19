import type {RunnerProtocol} from '@shipfox/runner-protocol/contract';
import {type WorkflowSpec, WorkflowStateMachine} from '#test/harness/state-machine.js';

/**
 * An in-memory {@link RunnerProtocol} backed by a {@link WorkflowStateMachine}. The
 * runner is driven through whole workflows against this fake with its real execution
 * layer and a real workspace; only the network is faked. The machine is returned
 * alongside the protocol so tests can assert on recorded claims/reports/heartbeats.
 *
 * Each method wraps the synchronous machine in a promise, so a thrown
 * JobLeaseNotFoundError / StepReportRejectedError surfaces as a rejection exactly as
 * the real client would surface a mapped 404 / 409.
 */
export function createFakeProtocol(spec: WorkflowSpec): {
  protocol: RunnerProtocol;
  machine: WorkflowStateMachine;
} {
  const machine = new WorkflowStateMachine(spec);

  const protocol: RunnerProtocol = {
    requestJob: async () => machine.requestJob(),
    heartbeat: async (jobId) => machine.heartbeat(jobId),
    forJob: (leaseToken) => ({
      requestNextStep: async () => machine.nextStep(leaseToken),
      reportStep: async (params) =>
        machine.reportStep(leaseToken, {
          stepId: params.stepId,
          attempt: params.attempt,
          status: params.status,
          error: params.error,
          exitCode: params.exitCode,
        }),
      requestCheckoutToken: async () => machine.checkoutToken(leaseToken),
      appendStepLogs: async (params) =>
        machine.appendStepLogs(leaseToken, {
          stepId: params.stepId,
          attempt: params.attempt,
          offset: params.offset,
          body: params.body,
        }),
    }),
  };

  return {protocol, machine};
}
