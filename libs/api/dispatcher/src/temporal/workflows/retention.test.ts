const mocks = vi.hoisted(() => ({
  pruneOutboxRetention: vi.fn(),
}));

vi.mock('@temporalio/workflow', () => ({
  proxyActivities: vi.fn(() => ({
    pruneOutboxRetention: mocks.pruneOutboxRetention,
  })),
}));

describe('outboxRetentionWorkflow', () => {
  beforeEach(() => {
    mocks.pruneOutboxRetention.mockReset();
  });

  it('prunes expired outbox rows', async () => {
    const {outboxRetentionWorkflow} = await import('./retention.js');

    await outboxRetentionWorkflow();

    expect(mocks.pruneOutboxRetention).toHaveBeenCalledOnce();
  });

  it('propagates a failure from the prune activity', async () => {
    const failure = new Error('prune failed');
    mocks.pruneOutboxRetention.mockRejectedValueOnce(failure);
    const {outboxRetentionWorkflow} = await import('./retention.js');

    await expect(outboxRetentionWorkflow()).rejects.toThrow(failure);
  });
});
