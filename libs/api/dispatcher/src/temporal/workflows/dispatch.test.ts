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

describe('outboxDispatcherWorkflow', () => {
  beforeEach(() => {
    mocks.continueAsNew.mockReset();
    mocks.drainAndDispatch.mockReset();
    mocks.pruneOutboxRetention.mockReset();
    mocks.sleep.mockReset();
  });

  it('drains repeatedly until the dispatcher reports no more backlog', async () => {
    const {outboxDispatcherWorkflow} = await import('./dispatch.js');
    mocks.drainAndDispatch.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await outboxDispatcherWorkflow();

    expect(mocks.drainAndDispatch).toHaveBeenCalledTimes(2);
    expect(mocks.sleep).toHaveBeenCalledWith('250ms');
    expect(mocks.continueAsNew).toHaveBeenCalledTimes(1);
  });
});
