import {nextBackoffInterval, pollDemand, shouldReturn} from '#core/demand.js';

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

  it('returns true when terminate intents exist', () => {
    const result = shouldReturn(
      {...emptyResult, terminateProvisionedRunnerIds: ['provisioned-runner-1']},
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

  it('returns immediately when terminate intents exist without reservation demand', async () => {
    vi.resetModules();
    const pollDemandAndReserveTx = vi.fn().mockResolvedValue({stats: [], reservations: []});
    const listProvisionerTerminateIntentsTx = vi.fn().mockResolvedValue(['provisioned-runner-1']);
    vi.doMock('#db/db.js', () => ({
      db: () => ({transaction: (callback: (tx: unknown) => Promise<unknown>) => callback({})}),
    }));
    vi.doMock('#db/reservations.js', () => ({
      deleteReservationsByIds: vi.fn(),
      pollDemandAndReserveTx,
    }));
    vi.doMock('#db/provisioned-runners.js', () => ({
      listProvisionerTerminateIntentsTx,
    }));

    try {
      const {pollDemand: mockedPollDemand} = await import('#core/demand.js');

      const result = await mockedPollDemand({
        workspaceId: crypto.randomUUID(),
        provisionerId: crypto.randomUUID(),
        maxReservations: 1,
        waitSeconds: 60,
        ttlSeconds: 60,
        terminateIntentLimit: 1000,
        templates: [
          {templateKey: 'linux', labels: ['linux'], availableSlots: 1, starting: 0, running: 0},
        ],
        signal: new AbortController().signal,
      });

      expect(result).toEqual({
        stats: [],
        reservations: [],
        terminateProvisionedRunnerIds: ['provisioned-runner-1'],
      });
      expect(pollDemandAndReserveTx).toHaveBeenCalledOnce();
      expect(listProvisionerTerminateIntentsTx).toHaveBeenCalledOnce();
    } finally {
      vi.doUnmock('#db/db.js');
      vi.doUnmock('#db/reservations.js');
      vi.doUnmock('#db/provisioned-runners.js');
      vi.resetModules();
    }
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
