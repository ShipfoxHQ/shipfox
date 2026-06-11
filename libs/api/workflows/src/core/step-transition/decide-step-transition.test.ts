import type {Step} from '../entities/step.js';
import {decideStepTransition, deriveCompletion, isTerminal} from './decide-step-transition.js';

function step(overrides: Partial<Step> & {id: string; position: number}): Step {
  return {
    jobId: 'job-1',
    name: null,
    status: 'pending',
    type: 'run',
    config: {},
    output: null,
    error: null,
    version: 1,
    currentAttempt: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('decideStepTransition', () => {
  test('a succeeded step with pending siblings advances the step', () => {
    const target = step({id: 's0', position: 0, status: 'running'});
    const steps = [target, step({id: 's1', position: 1, status: 'pending'})];

    const decision = decideStepTransition({
      steps,
      target,
      reportedAttempt: 1,
      result: {status: 'succeeded'},
    });

    expect(decision).toEqual({kind: 'complete-step', stepId: 's0', attempt: 1});
  });

  test('a succeeded step completes the job when every other step is terminal', () => {
    const target = step({id: 's1', position: 1, status: 'running'});
    const steps = [step({id: 's0', position: 0, status: 'succeeded'}), target];

    const decision = decideStepTransition({
      steps,
      target,
      reportedAttempt: 1,
      result: {status: 'succeeded'},
    });

    expect(decision).toEqual({kind: 'complete-job', stepId: 's1', attempt: 1});
  });

  test('a single succeeded step completes the job', () => {
    const target = step({id: 's0', position: 0, status: 'running'});

    const decision = decideStepTransition({
      steps: [target],
      target,
      reportedAttempt: 1,
      result: {status: 'succeeded'},
    });

    expect(decision).toEqual({kind: 'complete-job', stepId: 's0', attempt: 1});
  });

  test('a failed step fails the job and cancels from its position', () => {
    const target = step({id: 's1', position: 1, status: 'running'});
    const steps = [
      step({id: 's0', position: 0, status: 'succeeded'}),
      target,
      step({id: 's2', position: 2, status: 'pending'}),
    ];

    const decision = decideStepTransition({
      steps,
      target,
      reportedAttempt: 1,
      result: {status: 'failed', error: {message: 'boom'}},
    });

    expect(decision).toEqual({
      kind: 'fail-job',
      failedStepId: 's1',
      attempt: 1,
      cancelFromPosition: 1,
      failureError: {message: 'boom'},
    });
  });

  test('a passing gate succeeds the step even when the raw status is failed', () => {
    const target = step({id: 's0', position: 0, status: 'running'});
    const steps = [target, step({id: 's1', position: 1, status: 'pending'})];

    const decision = decideStepTransition({
      steps,
      target,
      reportedAttempt: 1,
      result: {status: 'failed', exitCode: 1, error: {message: 'exit 1'}},
      gateOutcome: {kind: 'passed', source: 'exit_code == 1'},
    });

    expect(decision).toEqual({kind: 'complete-step', stepId: 's0', attempt: 1});
  });

  test('a failing gate without on_failure fails the job with a gate_failed error', () => {
    const target = step({id: 's0', position: 0, status: 'running'});

    const decision = decideStepTransition({
      steps: [target],
      target,
      reportedAttempt: 1,
      result: {status: 'failed', exitCode: 1},
      gateOutcome: {kind: 'failed', source: 'exit_code == 0'},
    });

    expect(decision).toMatchObject({
      kind: 'fail-job',
      failedStepId: 's0',
      failureError: {kind: 'gate_failed', source: 'exit_code == 0'},
    });
  });

  test('a failing gate with restart_from fails closed (restart_unsupported) until PR E', () => {
    const target = step({id: 's1', position: 1, status: 'running'});

    const decision = decideStepTransition({
      steps: [step({id: 's0', position: 0, status: 'succeeded'}), target],
      target,
      reportedAttempt: 1,
      result: {status: 'failed', exitCode: 1},
      gateOutcome: {kind: 'failed', source: 'exit_code == 0'},
      gateOnFailure: {restartFrom: 's0'},
    });

    expect(decision).toMatchObject({
      kind: 'fail-job',
      failureError: {kind: 'restart_unsupported', restart_from: 's0'},
    });
  });

  test('an uncheckable gate (no exit code) is a plain command failure, not a restart', () => {
    const target = step({id: 's0', position: 0, status: 'running'});

    const decision = decideStepTransition({
      steps: [target],
      target,
      reportedAttempt: 1,
      result: {status: 'failed', exitCode: null, error: {message: 'killed'}},
      gateOutcome: {kind: 'uncheckable', reason: 'no exit code'},
      gateOnFailure: {restartFrom: 's0'},
    });

    expect(decision).toMatchObject({kind: 'fail-job', failureError: {message: 'killed'}});
  });

  test('echoes the reported attempt in the decision', () => {
    const target = step({id: 's0', position: 0, status: 'running', currentAttempt: 2});
    const steps = [target, step({id: 's1', position: 1, status: 'pending'})];

    const decision = decideStepTransition({
      steps,
      target,
      reportedAttempt: 2,
      result: {status: 'succeeded'},
    });

    expect(decision).toMatchObject({kind: 'complete-step', attempt: 2});
  });

  test('a failing gate overrides a raw succeeded status (downward override)', () => {
    const target = step({id: 's0', position: 0, status: 'running'});

    const decision = decideStepTransition({
      steps: [target],
      target,
      reportedAttempt: 1,
      result: {status: 'succeeded', exitCode: 0},
      gateOutcome: {kind: 'failed', source: 'exit_code == 1'},
    });

    expect(decision).toMatchObject({kind: 'fail-job', failureError: {kind: 'gate_failed'}});
  });

  test('a raw failure with on_failure but no success_if fails closed (restart_unsupported)', () => {
    const target = step({id: 's1', position: 1, status: 'running'});

    const decision = decideStepTransition({
      steps: [step({id: 's0', position: 0, status: 'succeeded'}), target],
      target,
      reportedAttempt: 1,
      result: {status: 'failed', exitCode: 1},
      // No gateOutcome (no success_if) but a restart policy is configured.
      gateOnFailure: {restartFrom: 's0'},
    });

    expect(decision).toMatchObject({
      kind: 'fail-job',
      failureError: {kind: 'restart_unsupported', restart_from: 's0'},
    });
  });
});

describe('deriveCompletion / isTerminal', () => {
  test('isTerminal covers the terminal states', () => {
    expect(isTerminal('succeeded')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('running')).toBe(false);
    expect(isTerminal('pending')).toBe(false);
  });

  test('deriveCompletion is succeeded only when every step succeeded', () => {
    expect(deriveCompletion([step({id: 'a', position: 0, status: 'succeeded'})])).toBe('succeeded');
    expect(
      deriveCompletion([
        step({id: 'a', position: 0, status: 'succeeded'}),
        step({id: 'b', position: 1, status: 'cancelled'}),
      ]),
    ).toBe('failed');
  });
});
