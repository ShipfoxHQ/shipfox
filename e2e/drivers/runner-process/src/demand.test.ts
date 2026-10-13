import {
  DemandPollTimeoutError,
  DemandReservationError,
  pollDemand,
  pollDemandUntil,
} from './demand.js';

const NO_DEMAND = {
  stats: [],
  reservations: [],
  terminate_provider_runner_ids: [],
};

const GRANT = {
  ...NO_DEMAND,
  reservations: [
    {
      reservation_id: '00000000-0000-4000-8000-000000000001',
      labels: ['cpu.16'],
      count: 1,
      expires_at: '2026-01-01T00:00:00.000Z',
    },
  ],
};

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
  });
}

function fetchMock(...bodies: unknown[]) {
  const fetch = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
    response(bodies.shift() ?? NO_DEMAND),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('pollDemand', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends one authenticated poll with provisioner template advertisements', async () => {
    const fetch = fetchMock(NO_DEMAND);

    await pollDemand({
      provisionerToken: 'provisioner-token',
      templates: [{name: 'xl', labels: ['cpu.16']}],
    });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toContain('/provisioners/demand/poll');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer provisioner-token');
    expect(JSON.parse(String(init?.body))).toEqual({
      max_reservations: 1,
      templates: [
        {
          template_key: 'xl',
          labels: ['cpu.16'],
          available_slots: 1,
          starting: 0,
          running: 0,
        },
      ],
    });
  });

  it('throws when a poll grants a reservation', async () => {
    fetchMock(GRANT);

    await expect(
      pollDemand({
        provisionerToken: 'provisioner-token',
        templates: [{name: 'xl', labels: ['cpu.16']}],
      }),
    ).rejects.toBeInstanceOf(DemandReservationError);
  });
});

describe('pollDemandUntil', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('repeats empty polls until the predicate observes the outcome', async () => {
    const fetch = fetchMock(NO_DEMAND, NO_DEMAND);
    let observed = 0;

    const result = await pollDemandUntil({
      provisionerToken: 'provisioner-token',
      templates: [{name: 'xl', labels: ['cpu.16']}],
      intervalMs: 0,
      timeoutMs: 100,
      until: () => {
        observed += 1;
        return observed === 2;
      },
    });

    expect(result).toEqual(NO_DEMAND);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(observed).toBe(2);
  });

  it('throws on a reservation found by a later poll', async () => {
    fetchMock(NO_DEMAND, GRANT);
    let observed = 0;

    await expect(
      pollDemandUntil({
        provisionerToken: 'provisioner-token',
        templates: [{name: 'xl', labels: ['cpu.16']}],
        intervalMs: 0,
        timeoutMs: 100,
        until: () => {
          observed += 1;
          return false;
        },
      }),
    ).rejects.toBeInstanceOf(DemandReservationError);
    expect(observed).toBe(1);
  });

  it('rejects with the last response and poll count at the timeout', async () => {
    const fetch = fetchMock(NO_DEMAND);

    const error = await pollDemandUntil({
      provisionerToken: 'provisioner-token',
      templates: [{name: 'xl', labels: ['cpu.16']}],
      intervalMs: 0,
      timeoutMs: 0,
      until: () => false,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DemandPollTimeoutError);
    expect(error).toMatchObject({response: NO_DEMAND, pollCount: 1, timeoutMs: 0});
    expect(fetch).toHaveBeenCalledOnce();
  });
});
