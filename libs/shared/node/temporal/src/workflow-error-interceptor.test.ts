const mocks = vi.hoisted(() => ({
  reportWorkflowError: vi.fn(),
  workflowInfo: vi.fn(),
}));

const temporal = vi.hoisted(() => ({TemporalFailure: class extends Error {}}));

vi.mock('@temporalio/common', () => ({TemporalFailure: temporal.TemporalFailure}));

vi.mock('@temporalio/workflow', () => ({
  proxySinks: () => ({shipfoxErrorMonitoring: {reportWorkflowError: mocks.reportWorkflowError}}),
  workflowInfo: mocks.workflowInfo,
}));

import {interceptors} from './workflow-error-interceptor.js';

beforeEach(() => {
  mocks.reportWorkflowError.mockReset();
  mocks.workflowInfo.mockReturnValue({
    workflowType: 'dispatch',
    taskQueue: 'workflows',
    workflowId: 'workflow-1',
    runId: 'run-1',
    attempt: 2,
  });
});

describe('workflow error interceptor', () => {
  test('reports workflow-code defects with safe workflow metadata and rethrows them', async () => {
    const error = new Error('workflow failed');
    const interceptor = interceptors().inbound?.[0];

    const result = interceptor?.execute?.({} as never, () => Promise.reject(error));

    await expect(result).rejects.toBe(error);
    expect(mocks.reportWorkflowError).toHaveBeenCalledWith({
      name: 'Error',
      message: 'workflow failed',
      stack: error.stack,
      workflowType: 'dispatch',
      taskQueue: 'workflows',
      workflowId: 'workflow-1',
      runId: 'run-1',
      attempt: 2,
    });
  });

  test('does not report Temporal control-flow failures', async () => {
    const error = new temporal.TemporalFailure('cancelled');
    const interceptor = interceptors().inbound?.[0];

    const result = interceptor?.execute?.({} as never, () => Promise.reject(error));

    await expect(result).rejects.toBe(error);
    expect(mocks.reportWorkflowError).not.toHaveBeenCalled();
  });
});
