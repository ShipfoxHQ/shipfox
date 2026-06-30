import {
  hasNoRequiredRunnerLabels,
  jobExecutionStartOutcome,
  resolveJobExecutionOutcomeSignal,
  runtimeStatusForTerminalJobExecutionStatus,
} from './job-execution-orchestration.js';

describe('hasNoRequiredRunnerLabels', () => {
  test.each([
    {labels: [], expected: true},
    {labels: [''], expected: true},
    {labels: ['  ', '\t'], expected: true},
    {labels: ['linux'], expected: false},
    {labels: ['', 'linux'], expected: false},
  ])('returns $expected for $labels', ({labels, expected}) => {
    const result = hasNoRequiredRunnerLabels(labels);

    expect(result).toBe(expected);
  });
});

describe('jobExecutionStartOutcome', () => {
  test.each(['pending', 'running', undefined])('continues for %s status', (status) => {
    const result = jobExecutionStartOutcome({newVersion: 4, status});

    expect(result).toEqual({kind: 'running', runningVersion: 4});
  });

  test('maps an already-succeeded execution to a succeeded runtime result', () => {
    const result = jobExecutionStartOutcome({newVersion: 7, status: 'succeeded'});

    expect(result).toEqual({
      kind: 'terminal',
      result: {status: 'succeeded', jobVersion: 7},
    });
  });

  test.each([
    'failed',
    'cancelled',
    'timed_out',
  ])('maps %s to a failed runtime result', (status) => {
    const result = jobExecutionStartOutcome({newVersion: 9, status});

    expect(result).toEqual({
      kind: 'terminal',
      result: {status: 'failed', jobVersion: 9},
    });
  });
});

describe('runtimeStatusForTerminalJobExecutionStatus', () => {
  test('preserves succeeded', () => {
    const result = runtimeStatusForTerminalJobExecutionStatus('succeeded');

    expect(result).toBe('succeeded');
  });

  test.each(['failed', 'cancelled', 'timed_out'])('maps %s to failed', (status) => {
    const result = runtimeStatusForTerminalJobExecutionStatus(status);

    expect(result).toBe('failed');
  });
});

describe('resolveJobExecutionOutcomeSignal', () => {
  test('prefers finished over lease expiration', () => {
    const result = resolveJobExecutionOutcomeSignal({
      finished: {status: 'succeeded'},
      leaseExpired: true,
    });

    expect(result).toBe('finished');
  });

  test('uses lease expiration when no finished signal arrived', () => {
    const result = resolveJobExecutionOutcomeSignal({finished: undefined, leaseExpired: true});

    expect(result).toBe('lease-expired');
  });

  test('uses timed out when no signal arrived before the condition timeout', () => {
    const result = resolveJobExecutionOutcomeSignal({finished: undefined, leaseExpired: false});

    expect(result).toBe('timed-out');
  });
});
