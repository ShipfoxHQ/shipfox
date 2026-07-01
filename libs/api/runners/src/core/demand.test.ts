import {sql} from 'drizzle-orm';
import {nextBackoffInterval, pollDemand, shouldReturn} from '#core/demand.js';
import {db} from '#db/db.js';

describe('shouldReturn', () => {
  const emptyResult = {stats: [], reservations: [], terminateProvisionedRunnerIds: []};

  it('returns true for observe-only requests', () => {
    const result = shouldReturn(emptyResult, 0, 1, false);

    expect(result).toBe(true);
  });

  it('returns true when no capacity is advertised', () => {
    const result = shouldReturn(emptyResult, 1, 0, false);

    expect(result).toBe(true);
  });

  it('returns true when reservations were granted', () => {
    const result = shouldReturn(
      {
        stats: [],
        reservations: [
          {reservationId: crypto.randomUUID(), labels: ['linux'], count: 1, expiresAt: new Date()},
        ],
        terminateProvisionedRunnerIds: [],
      },
      1,
      1,
      false,
    );

    expect(result).toBe(true);
  });

  it('returns true when the deadline passed', () => {
    const result = shouldReturn(emptyResult, 1, 1, true);

    expect(result).toBe(true);
  });

  it('returns false while demand is fully reserved and the deadline has not passed', () => {
    const result = shouldReturn(emptyResult, 1, 1, false);

    expect(result).toBe(false);
  });
});

describe('pollDemand', () => {
  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_pending_jobs, runners_reservations, runners_outbox CASCADE`,
    );
  });

  it('returns immediately when wait seconds is zero', async () => {
    const result = await pollDemand({
      workspaceId: crypto.randomUUID(),
      provisionerId: crypto.randomUUID(),
      maxReservations: 1,
      waitSeconds: 0,
      ttlSeconds: 60,
      terminateIntentLimit: 1000,
      templates: [
        {templateKey: 'linux', labels: ['linux'], availableSlots: 1, starting: 0, running: 0},
      ],
      signal: new AbortController().signal,
    });

    expect(result).toEqual({stats: [], reservations: [], terminateProvisionedRunnerIds: []});
  });
});

describe('nextBackoffInterval', () => {
  it('grows by 1.5x until the configured ceiling', () => {
    const grown = nextBackoffInterval(1000);
    const capped = nextBackoffInterval(5000);

    expect(grown).toBe(1500);
    expect(capped).toBe(5000);
  });
});
