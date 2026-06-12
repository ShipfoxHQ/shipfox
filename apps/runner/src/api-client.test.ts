// Exercises the real api-client (the mocked step-loop tests can't) to prove claim/heartbeat
// use the runner token and step calls use the lease token. SHIPFOX_API_URL comes from
// test/env.ts (setupFiles), loaded before config is imported.
import {
  createLeaseClient,
  heartbeat,
  reportStep,
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
