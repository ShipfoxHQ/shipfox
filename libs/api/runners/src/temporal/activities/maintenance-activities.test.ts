vi.mock('#core/maintenance.js', () => ({
  deleteExpiredEphemeralRegistrationTokens: vi.fn(),
  deleteExpiredJobExecutionTombstones: vi.fn(),
  deleteExpiredRunnerReservations: vi.fn(),
  deleteExpiredRunnerSessions: vi.fn(),
  detectAndExpireStuckJobs: vi.fn(),
  reapStaleRunnerInstances: vi.fn(),
  recoverStaleIdleRunnerSessions: vi.fn(),
}));
vi.mock('#core/purge-project.js', () => ({purgeUnfinishedDeletedProjects: vi.fn()}));
vi.mock('#db/capacity-holds.js', () => ({reconcileCapacityHolds: vi.fn()}));
vi.mock('#metrics/instance.js', () => ({
  recordCapacityHoldReconciliation: vi.fn(),
  recordCapacityHoldReleaseLag: vi.fn(),
  recordCapacityHoldSweep: vi.fn(),
}));

let maintenance: typeof import('#core/maintenance.js');
let purgeProject: typeof import('#core/purge-project.js');
let capacityHolds: typeof import('#db/capacity-holds.js');
let activities: typeof import('./maintenance-activities.js');

beforeEach(async () => {
  vi.resetModules();
  maintenance = await import('#core/maintenance.js');
  purgeProject = await import('#core/purge-project.js');
  capacityHolds = await import('#db/capacity-holds.js');
  activities = await import('./maintenance-activities.js');
  vi.clearAllMocks();
});

describe('detectAndExpireStuckJobsActivity', () => {
  it('delegates to core maintenance', async () => {
    vi.mocked(maintenance.detectAndExpireStuckJobs).mockResolvedValueOnce({expired: 2});

    const result = await activities.detectAndExpireStuckJobsActivity({thresholdSeconds: 180});

    expect(result).toEqual({expired: 2});
    expect(maintenance.detectAndExpireStuckJobs).toHaveBeenCalledWith({thresholdSeconds: 180});
  });
});

describe('deleteExpiredReservationsActivity', () => {
  it('delegates to core maintenance', async () => {
    vi.mocked(maintenance.deleteExpiredRunnerReservations).mockResolvedValueOnce({deleted: 3});

    const result = await activities.deleteExpiredReservationsActivity({limit: 50});

    expect(result).toEqual({deleted: 3});
    expect(maintenance.deleteExpiredRunnerReservations).toHaveBeenCalledWith({limit: 50});
  });
});

describe('reapStaleRunnerInstancesActivity', () => {
  it('delegates to core maintenance', async () => {
    vi.mocked(maintenance.reapStaleRunnerInstances).mockResolvedValueOnce({
      reaped: 4,
      reservationsReleased: 2,
    });

    const result = await activities.reapStaleRunnerInstancesActivity({
      thresholdSeconds: 300,
      limit: 100,
    });

    expect(result).toEqual({reaped: 4, reservationsReleased: 2});
    expect(maintenance.reapStaleRunnerInstances).toHaveBeenCalledWith({
      thresholdSeconds: 300,
      limit: 100,
    });
  });
});

describe('recoverStaleIdleRunnerSessionsActivity', () => {
  it('delegates to core maintenance', async () => {
    vi.mocked(maintenance.recoverStaleIdleRunnerSessions).mockResolvedValueOnce({recovered: 3});

    const result = await activities.recoverStaleIdleRunnerSessionsActivity({limit: 25});

    expect(result).toEqual({recovered: 3});
    expect(maintenance.recoverStaleIdleRunnerSessions).toHaveBeenCalledWith({limit: 25});
  });
});

describe('deleteExpiredJobExecutionTombstonesActivity', () => {
  it('delegates to core maintenance', async () => {
    vi.mocked(maintenance.deleteExpiredJobExecutionTombstones).mockResolvedValueOnce({deleted: 5});

    const result = await activities.deleteExpiredJobExecutionTombstonesActivity({limit: 25});

    expect(result).toEqual({deleted: 5});
    expect(maintenance.deleteExpiredJobExecutionTombstones).toHaveBeenCalledWith({limit: 25});
  });
});

describe('deleteExpiredRunnerSessionsActivity', () => {
  it('delegates to core maintenance', async () => {
    vi.mocked(maintenance.deleteExpiredRunnerSessions).mockResolvedValueOnce({deleted: 4});

    const result = await activities.deleteExpiredRunnerSessionsActivity({
      manualRetentionDays: 30,
      ephemeralRetentionDays: 7,
      limit: 25,
    });

    expect(result).toEqual({deleted: 4});
    expect(maintenance.deleteExpiredRunnerSessions).toHaveBeenCalledWith({
      manualRetentionDays: 30,
      ephemeralRetentionDays: 7,
      limit: 25,
    });
  });
});

describe('deleteExpiredEphemeralRegistrationTokensActivity', () => {
  it('delegates to core maintenance', async () => {
    vi.mocked(maintenance.deleteExpiredEphemeralRegistrationTokens).mockResolvedValueOnce({
      deleted: 6,
    });

    const result = await activities.deleteExpiredEphemeralRegistrationTokensActivity({
      retentionDays: 7,
      limit: 25,
    });

    expect(result).toEqual({deleted: 6});
    expect(maintenance.deleteExpiredEphemeralRegistrationTokens).toHaveBeenCalledWith({
      retentionDays: 7,
      limit: 25,
    });
  });
});

describe('runMaintenanceSweepActivity', () => {
  beforeEach(() => {
    vi.mocked(maintenance.deleteExpiredRunnerReservations).mockResolvedValue({deleted: 0});
    vi.mocked(maintenance.deleteExpiredJobExecutionTombstones).mockResolvedValue({deleted: 0});
    vi.mocked(maintenance.deleteExpiredRunnerSessions).mockResolvedValue({deleted: 0});
    vi.mocked(maintenance.deleteExpiredEphemeralRegistrationTokens).mockResolvedValue({
      deleted: 0,
    });
    vi.mocked(purgeProject.purgeUnfinishedDeletedProjects).mockResolvedValue({purged: 0});
    vi.mocked(maintenance.detectAndExpireStuckJobs).mockResolvedValue({expired: 0});
    vi.mocked(maintenance.recoverStaleIdleRunnerSessions).mockResolvedValue({recovered: 0});
    vi.mocked(capacityHolds.reconcileCapacityHolds).mockResolvedValue({reconciled: 0, swept: 0});
    vi.mocked(maintenance.reapStaleRunnerInstances).mockResolvedValue({
      reaped: 0,
      reservationsReleased: 0,
    });
  });

  it('runs every step in order', async () => {
    await activities.runMaintenanceSweepActivity({});

    const order = [
      maintenance.deleteExpiredRunnerReservations,
      maintenance.deleteExpiredJobExecutionTombstones,
      maintenance.deleteExpiredRunnerSessions,
      maintenance.deleteExpiredEphemeralRegistrationTokens,
      purgeProject.purgeUnfinishedDeletedProjects,
      maintenance.detectAndExpireStuckJobs,
      maintenance.recoverStaleIdleRunnerSessions,
      capacityHolds.reconcileCapacityHolds,
      maintenance.reapStaleRunnerInstances,
    ].map((step) => vi.mocked(step).mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a = 0, b = 0) => a - b));
    expect(order.every((call) => call !== undefined)).toBe(true);
    expect(maintenance.detectAndExpireStuckJobs).toHaveBeenCalledWith({thresholdSeconds: 180});
  });

  it('continues past a failed GC step', async () => {
    vi.mocked(maintenance.deleteExpiredRunnerSessions).mockRejectedValueOnce(
      new Error('database down'),
    );

    await activities.runMaintenanceSweepActivity({});

    expect(maintenance.detectAndExpireStuckJobs).toHaveBeenCalled();
    expect(maintenance.reapStaleRunnerInstances).toHaveBeenCalled();
  });

  it('continues past a failed purge of deleted projects', async () => {
    vi.mocked(purgeProject.purgeUnfinishedDeletedProjects).mockRejectedValueOnce(
      new Error('database down'),
    );

    await activities.runMaintenanceSweepActivity({});

    expect(maintenance.detectAndExpireStuckJobs).toHaveBeenCalled();
  });

  it('fails when stuck job expiry fails', async () => {
    vi.mocked(maintenance.detectAndExpireStuckJobs).mockRejectedValueOnce(
      new Error('database down'),
    );

    await expect(activities.runMaintenanceSweepActivity({})).rejects.toThrow('database down');
    expect(maintenance.reapStaleRunnerInstances).not.toHaveBeenCalled();
  });
});
