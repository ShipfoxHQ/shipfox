import {
  isTerminalLocalWorkflowRunStatus,
  localWorkflowRunsRefetchInterval,
} from './local-workflows.js';

describe('isTerminalLocalWorkflowRunStatus', () => {
  test.each([
    'completed',
    'runner_failed',
    'source_invalid',
    'input_rejected',
  ])('treats %s as terminal', (status) => {
    const result = isTerminalLocalWorkflowRunStatus(status);

    expect(result).toBe(true);
  });

  test.each(['running', 'received', 'queued', undefined])('treats %s as non-terminal', (status) => {
    const result = isTerminalLocalWorkflowRunStatus(status);

    expect(result).toBe(false);
  });
});

describe('localWorkflowRunsRefetchInterval', () => {
  test('polls quickly while any run is non-terminal', () => {
    const result = localWorkflowRunsRefetchInterval({
      runs: [
        {run_id: 'run-001', status: 'completed'},
        {run_id: 'run-002', status: 'received'},
      ],
    });

    expect(result).toBe(4_000);
  });

  test('backs off when every run is terminal', () => {
    const result = localWorkflowRunsRefetchInterval({
      runs: [
        {run_id: 'run-001', status: 'completed'},
        {run_id: 'run-002', status: 'runner_failed'},
      ],
    });

    expect(result).toBe(30_000);
  });
});
