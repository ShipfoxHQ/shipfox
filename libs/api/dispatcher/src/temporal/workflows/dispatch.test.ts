const mocks = vi.hoisted(() => ({
  continueAsNew: vi.fn(),
  drainAndDispatch: vi.fn(),
  pruneOutboxRetention: vi.fn(),
  sleep: vi.fn(),
}));

vi.mock('@temporalio/workflow', () => ({
  continueAsNew: mocks.continueAsNew,
  proxyActivities: vi.fn(() => ({
    drainAndDispatch: mocks.drainAndDispatch,
    pruneOutboxRetention: mocks.pruneOutboxRetention,
  })),
  sleep: mocks.sleep,
}));

import {DISPATCHER_WORKER_COUNT} from '#core/constants.js';

describe('outboxDispatcherWorkflow', () => {
  beforeEach(() => {
    mocks.continueAsNew.mockReset();
    mocks.drainAndDispatch.mockReset();
    mocks.pruneOutboxRetention.mockReset();
    mocks.sleep.mockReset();
  });

  it('drains repeatedly until the dispatcher reports no more backlog', async () => {
    const {outboxDispatcherWorkflow} = await import('./dispatch.js');
    const params = {workerIndex: 1, workerCount: 4};
    mocks.drainAndDispatch.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await outboxDispatcherWorkflow(params);

    expect(mocks.drainAndDispatch).toHaveBeenNthCalledWith(1, params);
    expect(mocks.drainAndDispatch).toHaveBeenNthCalledWith(2, params);
    expect(mocks.sleep).toHaveBeenCalledWith('250ms');
    expect(mocks.continueAsNew).toHaveBeenCalledWith(params);
  });

  it('defaults existing no-arg dispatcher executions to worker zero', async () => {
    const {outboxDispatcherWorkflow} = await import('./dispatch.js');
    mocks.drainAndDispatch.mockResolvedValueOnce(false);

    await outboxDispatcherWorkflow();

    const params = {workerIndex: 0, workerCount: DISPATCHER_WORKER_COUNT};
    expect(mocks.drainAndDispatch).toHaveBeenCalledWith(params);
    expect(mocks.continueAsNew).toHaveBeenCalledWith(params);
  });
});
