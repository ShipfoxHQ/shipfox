// Exercises the real protocol client over a stubbed fetch to prove claim/heartbeat use the
// runner token, step calls use the per-job lease token, the lease client retries POSTs, and
// 404/409 responses surface as typed errors rather than raw ky HTTPErrors.

import {JobLeaseNotFoundError, StepReportRejectedError} from '#contract.js';
import {createProtocolClient} from '#protocol-client.js';

const BASE_URL = 'https://api.test';
const RUNNER_TOKEN = 'test-runner-token';
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

function client() {
  return createProtocolClient({baseUrl: BASE_URL, runnerToken: RUNNER_TOKEN});
}

describe('createProtocolClient auth contexts', () => {
  it('requestJob sends the runner token and parses the step-less claim + lease token', async () => {
    stubFetch(() => jsonResponse({job_id: JOB_ID, run_id: RUN_ID, lease_token: 'lease-xyz'}));

    const job = await client().requestJob();

    expect(job?.job_id).toBe(JOB_ID);
    expect(job?.run_id).toBe(RUN_ID);
    expect(job?.lease_token).toBe('lease-xyz');
    expect(calls[0]?.url).toContain('runners/jobs/request');
    expect(calls[0]?.authorization).toBe(`Bearer ${RUNNER_TOKEN}`);
  });

  it('requestJob returns null on 204', async () => {
    stubFetch(() => new Response(null, {status: 204}));

    const job = await client().requestJob();

    expect(job).toBeNull();
  });

  it('requestJob forwards the abort signal so a hung claim can be cancelled', async () => {
    const ac = new AbortController();
    ac.abort();
    stubFetch(() => new Response(null, {status: 204}));

    await expect(client().requestJob({signal: ac.signal})).rejects.toThrow();
  });

  it('heartbeat sends the runner token', async () => {
    stubFetch(() => jsonResponse({cancel: false}));

    await client().heartbeat(JOB_ID);

    expect(calls[0]?.url).toContain(`runners/jobs/${JOB_ID}/heartbeat`);
    expect(calls[0]?.authorization).toBe(`Bearer ${RUNNER_TOKEN}`);
  });

  it('requestNextStep sends the lease token, not the runner token', async () => {
    stubFetch(() => jsonResponse({kind: 'done', status: 'succeeded'}));

    const next = await client().forJob('lease-abc').requestNextStep();

    expect(next).toEqual({kind: 'done', status: 'succeeded'});
    expect(calls[0]?.url).toContain('runs/jobs/current/steps/next');
    expect(calls[0]?.authorization).toBe('Bearer lease-abc');
  });

  it('reportStep sends the lease token to the per-step report endpoint', async () => {
    stubFetch(() => jsonResponse({ok: true, cancel: false}));

    const result = await client().forJob('lease-def').reportStep({
      stepId: STEP_ID,
      attempt: 1,
      status: 'succeeded',
      exitCode: 0,
    });

    expect(result).toEqual({ok: true, cancel: false});
    expect(calls[0]?.url).toContain(`runs/jobs/current/steps/${STEP_ID}/report`);
    expect(calls[0]?.authorization).toBe('Bearer lease-def');
  });

  it('requestCheckoutToken sends the lease token and parses the checkout response', async () => {
    stubFetch(() =>
      jsonResponse({
        repository_url: 'https://github.com/acme/repo.git',
        ref: 'main',
        auth: {kind: 'bearer', token: 'tok-123', expires_at: '2026-01-01T00:00:00.000Z'},
      }),
    );

    const checkout = await client().forJob('lease-ghi').requestCheckoutToken();

    expect(checkout.repository_url).toBe('https://github.com/acme/repo.git');
    expect(checkout.ref).toBe('main');
    expect(calls[0]?.url).toContain('runs/jobs/current/checkout-token');
    expect(calls[0]?.authorization).toBe('Bearer lease-ghi');
  });
});

describe('createProtocolClient error mapping', () => {
  it('maps a 404 on next-step to JobLeaseNotFoundError', async () => {
    stubFetch(() => jsonResponse({code: 'job-not-found'}, 404));

    await expect(client().forJob('lease-abc').requestNextStep()).rejects.toBeInstanceOf(
      JobLeaseNotFoundError,
    );
  });

  it('maps a 404 on heartbeat to JobLeaseNotFoundError', async () => {
    stubFetch(() => jsonResponse({code: 'job-not-found'}, 404));

    await expect(client().heartbeat(JOB_ID)).rejects.toBeInstanceOf(JobLeaseNotFoundError);
  });

  it('maps a 409 on report to StepReportRejectedError', async () => {
    stubFetch(() => jsonResponse({code: 'step-not-running'}, 409));

    await expect(
      client().forJob('lease-def').reportStep({
        stepId: STEP_ID,
        attempt: 1,
        status: 'succeeded',
        exitCode: 0,
      }),
    ).rejects.toBeInstanceOf(StepReportRejectedError);
  });

  it('retries a lease POST on 500 then succeeds (POST retry is enabled)', async () => {
    let attempts = 0;
    stubFetch(() => {
      attempts += 1;
      return attempts === 1
        ? jsonResponse({code: 'oops'}, 500)
        : jsonResponse({ok: true, cancel: false});
    });

    const result = await client().forJob('lease-r').reportStep({
      stepId: STEP_ID,
      attempt: 1,
      status: 'succeeded',
      exitCode: 0,
    });

    expect(result).toEqual({ok: true, cancel: false});
    expect(attempts).toBe(2);
  });
});

describe('appendStepLogs status mapping', () => {
  it('posts NDJSON to the lease-authed logs endpoint and parses committed', async () => {
    stubFetch(() => jsonResponse({committed_length: 42, capped: false}));

    const outcome = await client()
      .forJob('lease-log')
      .appendStepLogs({
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

  it('returns conflict with the committed offset on 409', async () => {
    stubFetch(() => jsonResponse({code: 'offset-gap', details: {committed_length: 7}}, 409));

    const outcome = await client()
      .forJob('lease-log')
      .appendStepLogs({
        stepId: STEP_ID,
        attempt: 1,
        offset: 99,
        body: new Uint8Array([1]),
      });

    expect(outcome).toEqual({status: 'conflict', committedLength: 7});
  });

  it.each([
    404, 401, 403, 400, 413,
  ])('returns stopped on a terminal %i so it is not retried forever', async (status) => {
    stubFetch(() => new Response(null, {status}));

    const outcome = await client()
      .forJob('lease-log')
      .appendStepLogs({
        stepId: STEP_ID,
        attempt: 1,
        offset: 0,
        body: new Uint8Array([1]),
      });

    expect(outcome).toEqual({status: 'stopped'});
  });

  it.each([
    429, 500, 503,
  ])('throws on a transient %i so the uploader retries it', async (status) => {
    stubFetch(() => new Response(null, {status}));

    await expect(
      client()
        .forJob('lease-log')
        .appendStepLogs({
          stepId: STEP_ID,
          attempt: 1,
          offset: 0,
          body: new Uint8Array([1]),
        }),
    ).rejects.toThrow('Log append failed with status');
  });

  it('rejects a malformed step id before hitting the network', async () => {
    stubFetch(() => jsonResponse({committed_length: 0, capped: false}));

    await expect(
      client()
        .forJob('lease-log')
        .appendStepLogs({
          stepId: 'not-a-uuid',
          attempt: 1,
          offset: 0,
          body: new Uint8Array([1]),
        }),
    ).rejects.toThrow('Invalid step id');
    expect(calls).toHaveLength(0);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

function stubFetch(handler: (url: string) => Response): void {
  globalThis.fetch = vi.fn((input: Request | string | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (request.signal?.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }
    calls.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get('authorization'),
    });
    return Promise.resolve(handler(request.url));
  }) as unknown as typeof globalThis.fetch;
}
