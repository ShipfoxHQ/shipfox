// The fake state machine encodes real dispatch/idempotency/cancel logic, so it is
// itself a bug surface. These tests pin its behavior so a faulty fake can't hand the
// runner false-green workflow results.

import {JobLeaseNotFoundError, StepReportRejectedError} from '@shipfox/runner-protocol/contract';
import {WorkflowStateMachine} from '#test/harness/state-machine.js';

function machine(overrides = {}) {
  return new WorkflowStateMachine({steps: [{run: 'echo a'}, {run: 'echo b'}], ...overrides});
}

describe('WorkflowStateMachine', () => {
  it('dispatches setup then run steps in position order and completes succeeded', () => {
    const m = machine();
    const lease = m.requestJob()?.lease_token as string;

    const first = m.nextStep(lease);
    expect(first.kind === 'step' && first.step.type).toBe('setup');
    m.reportStep(lease, {stepId: stepId(first), attempt: 1, status: 'succeeded', exitCode: 0});

    const second = m.nextStep(lease);
    expect(second.kind === 'step' && second.step.position).toBe(1);
    m.reportStep(lease, {stepId: stepId(second), attempt: 1, status: 'succeeded', exitCode: 0});

    const third = m.nextStep(lease);
    expect(third.kind === 'step' && third.step.position).toBe(2);
    const last = m.reportStep(lease, {
      stepId: stepId(third),
      attempt: 1,
      status: 'succeeded',
      exitCode: 0,
    });

    expect(last.cancel).toBe(false);
    expect(m.nextStep(lease)).toEqual({kind: 'done', status: 'succeeded'});
  });

  it('re-delivers the running step on a repeated next call (idempotent)', () => {
    const m = machine();
    const lease = m.requestJob()?.lease_token as string;

    const a = m.nextStep(lease);
    const b = m.nextStep(lease);

    expect(stepId(a)).toBe(stepId(b));
  });

  it('cancels remaining steps and returns cancel:true when a step fails', () => {
    const m = machine();
    const lease = m.requestJob()?.lease_token as string;
    const setup = m.nextStep(lease);
    m.reportStep(lease, {stepId: stepId(setup), attempt: 1, status: 'succeeded', exitCode: 0});
    const run = m.nextStep(lease);

    const result = m.reportStep(lease, {
      stepId: stepId(run),
      attempt: 1,
      status: 'failed',
      error: {message: 'boom', exit_code: 1},
      exitCode: 1,
    });

    expect(result.cancel).toBe(true);
    const states = m.snapshot();
    expect(states.find((s) => s.position === 1)?.status).toBe('failed');
    expect(states.find((s) => s.position === 2)?.status).toBe('cancelled');
    expect(m.nextStep(lease)).toEqual({kind: 'done', status: 'failed'});
  });

  it('rejects a report for a step that was never dispatched', () => {
    const m = machine();
    const lease = m.requestJob()?.lease_token as string;
    const undispatched = m.snapshot()[1]?.id as string;

    expect(() =>
      m.reportStep(lease, {stepId: undispatched, attempt: 1, status: 'succeeded', exitCode: 0}),
    ).toThrow(StepReportRejectedError);
  });

  it('rejects a report whose attempt is ahead of dispatch', () => {
    const m = machine();
    const lease = m.requestJob()?.lease_token as string;
    const setup = m.nextStep(lease);

    expect(() =>
      m.reportStep(lease, {stepId: stepId(setup), attempt: 2, status: 'succeeded', exitCode: 0}),
    ).toThrow(StepReportRejectedError);
  });

  it('throws JobLeaseNotFoundError from nextStep when failNextStep is set', () => {
    const m = machine({failNextStep: true});
    const lease = m.requestJob()?.lease_token as string;

    expect(() => m.nextStep(lease)).toThrow(JobLeaseNotFoundError);
  });

  it('throws StepReportRejectedError from reportStep when failReport is set', () => {
    const m = machine({failReport: true});
    const lease = m.requestJob()?.lease_token as string;
    const setup = m.nextStep(lease);

    expect(() =>
      m.reportStep(lease, {stepId: stepId(setup), attempt: 1, status: 'succeeded', exitCode: 0}),
    ).toThrow(StepReportRejectedError);
  });

  it('reports cancel via heartbeat and orphan via finalizeOnHeartbeat', () => {
    const cancelM = machine({cancelOnHeartbeat: true});
    expect(cancelM.heartbeat(cancelM.jobId)).toEqual({cancel: true});

    const orphanM = machine({finalizeOnHeartbeat: true});
    expect(() => orphanM.heartbeat(orphanM.jobId)).toThrow(JobLeaseNotFoundError);
  });

  it('serves one job by default then returns null, and throws transient claim failures first', () => {
    const m = machine({failClaims: 1});

    expect(() => m.requestJob()).toThrow();
    expect(m.requestJob()).not.toBeNull();
    expect(m.requestJob()).toBeNull();
  });
});

function stepId(next: {kind: 'step'; step: {id: string}} | {kind: 'done'}): string {
  if (next.kind !== 'step') throw new Error('expected a step response');
  return next.step.id;
}
