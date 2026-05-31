import {isTerminalLocalWorkflowRunStatus} from './local-workflows.js';

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
