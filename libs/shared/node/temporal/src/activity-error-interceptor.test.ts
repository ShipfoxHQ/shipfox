import {CancelledFailure} from '@temporalio/common';

const errorMonitoring = vi.hoisted(() => ({isErrorReported: vi.fn(), reportError: vi.fn()}));

vi.mock('@shipfox/node-error-monitoring', () => errorMonitoring);

import {createActivityErrorInterceptor, getWorkerInterceptors} from './interceptors.js';

const activityContext = {
  info: {
    activityId: 'activity-1',
    activityType: 'compactStream',
    attempt: 2,
    taskQueue: 'logs',
    workflowExecution: {runId: 'run-1', workflowId: 'workflow-1'},
  },
};

afterEach(() => vi.clearAllMocks());

describe('Temporal activity error interceptor', () => {
  beforeEach(() => errorMonitoring.isErrorReported.mockReturnValue(false));

  test('registers the activity interceptor', () => {
    expect(getWorkerInterceptors().activityInbound).toEqual([createActivityErrorInterceptor]);
  });

  test('reports an unexpected activity attempt and rethrows the same error', async () => {
    const error = new Error('activity failed');
    const interceptor = createActivityErrorInterceptor(activityContext as never);

    const result = interceptor.execute?.({args: [], headers: {} as never}, () =>
      Promise.reject(error),
    );

    await expect(result).rejects.toBe(error);
    expect(errorMonitoring.reportError).toHaveBeenCalledWith(error, {
      boundary: 'temporal.activity',
      tags: {activityType: 'compactStream', taskQueue: 'logs'},
      extra: {
        activityId: 'activity-1',
        attempt: 2,
        runId: 'run-1',
        workflowId: 'workflow-1',
      },
    });
  });

  test('does not report cancellation or an error reported at an inner boundary', async () => {
    const cancellation = new CancelledFailure('cancelled');
    const interceptor = createActivityErrorInterceptor(activityContext as never);

    const cancelled = interceptor.execute?.({args: [], headers: {} as never}, () =>
      Promise.reject(cancellation),
    );

    await expect(cancelled).rejects.toBe(cancellation);
    expect(errorMonitoring.reportError).not.toHaveBeenCalled();

    const reported = new Error('already reported');
    errorMonitoring.isErrorReported.mockReturnValue(true);
    const result = interceptor.execute?.({args: [], headers: {} as never}, () =>
      Promise.reject(reported),
    );

    await expect(result).rejects.toBe(reported);
    expect(errorMonitoring.reportError).not.toHaveBeenCalled();
  });
});
