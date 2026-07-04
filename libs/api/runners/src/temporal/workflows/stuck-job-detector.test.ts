const mocks = vi.hoisted(() => ({
  deleteExpiredReservationsActivity: vi.fn(),
  deleteExpiredRunnerSessionsActivity: vi.fn(),
  detectAndExpireStuckJobsActivity: vi.fn(),
  reapStaleProvisionedRunnersActivity: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@temporalio/workflow', () => ({
  log: {
    info: mocks.info,
    warn: mocks.warn,
  },
  proxyActivities: vi.fn(() => ({
    deleteExpiredReservationsActivity: mocks.deleteExpiredReservationsActivity,
    deleteExpiredRunnerSessionsActivity: mocks.deleteExpiredRunnerSessionsActivity,
    detectAndExpireStuckJobsActivity: mocks.detectAndExpireStuckJobsActivity,
    reapStaleProvisionedRunnersActivity: mocks.reapStaleProvisionedRunnersActivity,
  })),
}));

describe('stuckJobDetector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteExpiredReservationsActivity.mockResolvedValue({deleted: 0});
    mocks.deleteExpiredRunnerSessionsActivity.mockResolvedValue({deleted: 0});
    mocks.detectAndExpireStuckJobsActivity.mockResolvedValue({expired: 0});
    mocks.reapStaleProvisionedRunnersActivity.mockResolvedValue({
      reaped: 0,
      reservationsReleased: 0,
    });
  });

  it('runs expired session GC before stuck job expiry and logs deletions', async () => {
    const {stuckJobDetector} = await import('./stuck-job-detector.js');
    mocks.deleteExpiredRunnerSessionsActivity.mockResolvedValueOnce({deleted: 2});

    await stuckJobDetector();

    expect(mocks.deleteExpiredRunnerSessionsActivity).toHaveBeenCalledWith();
    expect(mocks.detectAndExpireStuckJobsActivity).toHaveBeenCalledWith({thresholdSeconds: 180});
    expect(mocks.info).toHaveBeenCalledWith('Stuck-job detector deleted expired runner sessions', {
      deleted: 2,
    });
  });

  it('continues stuck job expiry when expired session GC fails', async () => {
    const {stuckJobDetector} = await import('./stuck-job-detector.js');
    mocks.deleteExpiredRunnerSessionsActivity.mockRejectedValueOnce(new Error('database down'));

    await stuckJobDetector();

    expect(mocks.warn).toHaveBeenCalledWith(
      'Stuck-job detector failed to delete expired runner sessions',
      {error: 'database down'},
    );
    expect(mocks.detectAndExpireStuckJobsActivity).toHaveBeenCalledWith({thresholdSeconds: 180});
  });
});
