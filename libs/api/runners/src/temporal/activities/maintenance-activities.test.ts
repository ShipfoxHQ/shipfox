import {
  deleteExpiredRunnerReservations,
  detectAndExpireStuckJobs,
  reapStaleProvisionedRunners,
} from '#core/maintenance.js';
import {
  deleteExpiredReservationsActivity,
  detectAndExpireStuckJobsActivity,
  reapStaleProvisionedRunnersActivity,
} from './maintenance-activities.js';

vi.mock('#core/maintenance.js', () => ({
  deleteExpiredRunnerReservations: vi.fn(),
  detectAndExpireStuckJobs: vi.fn(),
  reapStaleProvisionedRunners: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('detectAndExpireStuckJobsActivity', () => {
  it('delegates to core maintenance', async () => {
    vi.mocked(detectAndExpireStuckJobs).mockResolvedValueOnce({expired: 2});

    const result = await detectAndExpireStuckJobsActivity({thresholdSeconds: 180});

    expect(result).toEqual({expired: 2});
    expect(detectAndExpireStuckJobs).toHaveBeenCalledWith({thresholdSeconds: 180});
  });
});

describe('deleteExpiredReservationsActivity', () => {
  it('delegates to core maintenance', async () => {
    vi.mocked(deleteExpiredRunnerReservations).mockResolvedValueOnce({deleted: 3});

    const result = await deleteExpiredReservationsActivity({limit: 50});

    expect(result).toEqual({deleted: 3});
    expect(deleteExpiredRunnerReservations).toHaveBeenCalledWith({limit: 50});
  });
});

describe('reapStaleProvisionedRunnersActivity', () => {
  it('delegates to core maintenance', async () => {
    vi.mocked(reapStaleProvisionedRunners).mockResolvedValueOnce({
      reaped: 4,
      reservationsReleased: 2,
    });

    const result = await reapStaleProvisionedRunnersActivity({
      thresholdSeconds: 300,
      limit: 100,
    });

    expect(result).toEqual({reaped: 4, reservationsReleased: 2});
    expect(reapStaleProvisionedRunners).toHaveBeenCalledWith({
      thresholdSeconds: 300,
      limit: 100,
    });
  });
});
