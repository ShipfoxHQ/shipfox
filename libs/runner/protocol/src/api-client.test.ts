// Exercises the real api-client (the mocked step-loop tests can't) to prove claim/heartbeat
// use the runner token and step calls use the lease token. SHIPFOX_API_URL comes from
// test/env.ts (setupFiles), loaded before config is imported.

import {
  appendStepLogs,
  createLeaseClient,
  heartbeat,
  reportStep,
  requestCheckoutToken,
  requestJob,
  requestNextStep,
} from '#api-client.js';
import {config} from '#config.js';

const JOB_ID = crypto.randomUUID();
const RUN_ID = crypto.randomUUID();
const STEP_ID = crypto.randomUUID();

let calls: Array<{url: string; method: string; authorization: string | null}>;
let originalFetch: typeof globalThis.fetch;

beforeAll(() => {
  originalFetch = globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  calls = [];
});

describe('api-client auth contexts', () => {
  it('requestJob sends the runner token and parses the step-less claim + lease token', async () => {
    stubFetch(() => jsonResponse(claimResponse()));

    const job = await requestJob();

    expect(job?.job_id).toBe(JOB_ID);
    expect(job?.run_id).toBe(RUN_ID);
    expect(job?.lease_token).toBe('lease-xyz');
    // The claim is step-less: no job_name / steps are required to parse.
    expect(job).not.toHaveProperty('steps');
    expect(job).not.toHaveProperty('job_name');
    expect(calls[0]?.url).toContain('runners/jobs/request');
    expect(calls[0]?.authorization).toBe(`Bearer ${config.SHIPFOX_RUNNER_TOKEN}`);
  });

  it('requestJob returns null on 204', async () => {
    stubFetch(() => new Response(null, {status: 204}));

    const job = await requestJob();

    expect(job).toBeNull();
  });

  it('heartbeat sends the runner token', async () => {
    stubFetch(() => jsonResponse({cancel: false}));

    await heartbeat(JOB_ID);

    expect(calls[0]?.url).toContain(`runners/jobs/${JOB_ID}/heartbeat`);
    expect(calls[0]?.authorization).toBe(`Bearer ${config.SHIPFOX_RUNNER_TOKEN}`);
  });

  it('requestNextStep sends the lease token, not the runner token', async () => {
    stubFetch(() => jsonResponse({kind: 'done', status: 'succeeded'}));
    const leaseClient = createLeaseClient('lease-abc');

    const next = await requestNextStep(leaseClient);

    expect(next).toEqual({kind: 'done', status: 'succeeded'});
    expect(calls[0]?.url).toContain('runs/jobs/current/steps/next');
    expect(calls[0]?.authorization).toBe('Bearer lease-abc');
  });

  it('requestCheckoutToken sends the lease token and parses the checkout response', async () => {
    stubFetch(() =>
      jsonResponse({
        repository_url: 'https://github.com/acme/repo.git',
        ref: 'main',
        auth: {kind: 'bearer', token: 'tok-123', expires_at: '2026-01-01T00:00:00.000Z'},
      }),
    );
    const leaseClient = createLeaseClient('lease-ghi');

    const checkout = await requestCheckoutToken(leaseClient);

    expect(checkout.repository_url).toBe('https://github.com/acme/repo.git');
    expect(checkout.ref).toBe('main');
    expect(calls[0]?.url).toContain('runs/jobs/current/checkout-token');
    expect(calls[0]?.authorization).toBe('Bearer lease-ghi');
  });

  it('reportStep sends the lease token to the per-step report endpoint', async () => {
    stubFetch(() => jsonResponse({ok: true, cancel: false}));
    const leaseClient = createLeaseClient('lease-def');

    const result = await reportStep(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      status: 'succeeded',
      exitCode: 0,
    });

    expect(result).toEqual({ok: true, cancel: false});
    expect(calls[0]?.url).toContain(`runs/jobs/current/steps/${STEP_ID}/report`);
    expect(calls[0]?.authorization).toBe('Bearer lease-def');
  });
});

describe('appendStepLogs', () => {
  it('posts NDJSON to the lease-authed logs endpoint and parses committed', async () => {
    stubFetch(() => jsonResponse({committed_length: 42, capped: false}));
    const leaseClient = createLeaseClient('lease-log');

    const outcome = await appendStepLogs(leaseClient, {
      stepId: STEP_ID,
      attempt: 2,
      offset: 10,
      body: new Uint8Array([1, 2, 3]),
    });

    expect(outcome).toEqual({status: 'committed', committedLength: 42, capped: false});
    expect(calls[0]?.url).toContain(`runs/jobs/current/steps/${STEP_ID}/logs`);
    expect(calls[0]?.url).toContain('attempt=2');
    expect(calls[0]?.url).toContain('offset=10');
    expect(calls[0]?.authorization).toBe('Bearer lease-log');
  });

  it('surfaces the capped flag from the server', async () => {
    stubFetch(() => jsonResponse({committed_length: 100, capped: true}));
    const leaseClient = createLeaseClient('lease-log');

    const outcome = await appendStepLogs(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      offset: 0,
      body: new Uint8Array([1]),
    });

    expect(outcome).toEqual({status: 'committed', committedLength: 100, capped: true});
  });

  it('returns conflict with the committed offset on 409', async () => {
    stubFetch(() => jsonResponse({code: 'offset-gap', details: {committed_length: 7}}, 409));
    const leaseClient = createLeaseClient('lease-log');

    const outcome = await appendStepLogs(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      offset: 99,
      body: new Uint8Array([1]),
    });

    expect(outcome).toEqual({status: 'conflict', committedLength: 7});
  });

  it('returns stopped when the endpoint is absent (404)', async () => {
    stubFetch(() => new Response(null, {status: 404}));
    const leaseClient = createLeaseClient('lease-log');

    const outcome = await appendStepLogs(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      offset: 0,
      body: new Uint8Array(0),
    });

    expect(outcome).toEqual({status: 'stopped'});
  });

  it('returns stopped when the lease is rejected (401)', async () => {
    stubFetch(() => new Response(null, {status: 401}));
    const leaseClient = createLeaseClient('lease-log');

    const outcome = await appendStepLogs(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      offset: 0,
      body: new Uint8Array(0),
    });

    expect(outcome).toEqual({status: 'stopped'});
  });

  it('returns stopped when the lease is forbidden (403)', async () => {
    stubFetch(() => new Response(null, {status: 403}));
    const leaseClient = createLeaseClient('lease-log');

    const outcome = await appendStepLogs(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      offset: 0,
      body: new Uint8Array(0),
    });

    expect(outcome).toEqual({status: 'stopped'});
  });

  it('returns stopped on a permanently rejected body (400) so it is not retried forever', async () => {
    stubFetch(() => jsonResponse({code: 'malformed-log-chunk'}, 400));
    const leaseClient = createLeaseClient('lease-log');

    const outcome = await appendStepLogs(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      offset: 0,
      body: new Uint8Array([1]),
    });

    expect(outcome).toEqual({status: 'stopped'});
  });

  it('returns stopped on an over-large body (413)', async () => {
    stubFetch(() => new Response(null, {status: 413}));
    const leaseClient = createLeaseClient('lease-log');

    const outcome = await appendStepLogs(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      offset: 0,
      body: new Uint8Array([1]),
    });

    expect(outcome).toEqual({status: 'stopped'});
  });

  it('throws on 429 so a transient rate-limit is retried, not abandoned', async () => {
    stubFetch(() => new Response(null, {status: 429}));
    const leaseClient = createLeaseClient('lease-log');

    const append = appendStepLogs(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      offset: 0,
      body: new Uint8Array([1]),
    });

    await expect(append).rejects.toThrow('Log append failed with status 429');
  });

  it('throws on an unexpected status so the uploader retries on its next tick', async () => {
    stubFetch(() => new Response(null, {status: 500}));
    const leaseClient = createLeaseClient('lease-log');

    const append = appendStepLogs(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      offset: 0,
      body: new Uint8Array([1]),
    });

    await expect(append).rejects.toThrow('Log append failed with status 500');
  });

  it('rejects a non-UUID step id before making any request', async () => {
    const leaseClient = createLeaseClient('lease-log');

    const append = appendStepLogs(leaseClient, {
      stepId: '../escape',
      attempt: 1,
      offset: 0,
      body: new Uint8Array(0),
    });

    await expect(append).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

function claimResponse() {
  return {
    job_id: JOB_ID,
    run_id: RUN_ID,
    lease_token: 'lease-xyz',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

function stubFetch(handler: (url: string) => Response): void {
  globalThis.fetch = vi.fn((input: Request | string | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    calls.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get('authorization'),
    });
    return Promise.resolve(handler(request.url));
  }) as unknown as typeof globalThis.fetch;
}
