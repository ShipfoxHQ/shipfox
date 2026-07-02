// Exercises the real api-client (the mocked step-loop tests can't) to prove registration,
// claim, heartbeat, and step calls use the right bearer token class. SHIPFOX_API_URL comes
// from test/env.ts (setupFiles), loaded before config is imported.

import {RUNNER_SESSION_EXHAUSTED_CODE} from '@shipfox/api-runners-dto';
import {
  AgentRuntimeConfigRequestError,
  appendStepLogs,
  createLeaseClient,
  HTTPError,
  heartbeat,
  RunnerSessionExhaustedError,
  registerRunnerSession,
  reportStep,
  requestAgentRuntimeConfig,
  requestCheckoutToken,
  requestJob,
  requestNextStep,
  requireRunnerLabels,
} from '#api-client.js';
import {config} from '#config.js';

const JOB_ID = crypto.randomUUID();
const JOB_EXECUTION_ID = crypto.randomUUID();
const WORKFLOW_RUN_ID = crypto.randomUUID();
const WORKFLOW_RUN_ATTEMPT_ID = crypto.randomUUID();
const STEP_ID = crypto.randomUUID();
const SESSION_ID = crypto.randomUUID();
const ZOD_ERROR_TEXT_REGEX = /Zod|Invalid|Required/;

let calls: Array<{url: string; method: string; authorization: string | null; body: string}>;
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('runner labels', () => {
  it('canonicalizes configured labels', () => {
    const labels = requireRunnerLabels();

    expect(labels).toEqual(['linux', 'x64']);
  });

  it.each(['', ' , , '])('throws when SHIPFOX_RUNNER_LABELS is %j', async (labels) => {
    vi.stubEnv('SHIPFOX_RUNNER_LABELS', labels);
    vi.resetModules();

    const {
      requireRunnerLabels: loadLabels,
      RunnerLabelsRequiredError: LoadedRunnerLabelsRequiredError,
    } = await import('#api-client.js');

    expect(() => loadLabels()).toThrow(LoadedRunnerLabelsRequiredError);
  });
});

describe('api-client auth contexts', () => {
  it('registerRunnerSession sends the registration token and configured labels', async () => {
    stubFetch(() => jsonResponse(registerResponse()));

    const session = await registerRunnerSession();

    expect(session).toEqual(registerResponse());
    expect(calls[0]?.url).toContain('runners/register');
    expect(calls[0]?.authorization).toBe(`Bearer ${config.SHIPFOX_RUNNER_REGISTRATION_TOKEN}`);
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({labels: ['linux', 'x64']});
  });

  it('requestJob sends the runner session token and parses the step-less claim + lease token', async () => {
    stubFetch(() => jsonResponse(claimResponse()));

    const job = await requestJob('session-abc');

    expect(job?.job_id).toBe(JOB_ID);
    expect(job?.job_execution_id).toBe(JOB_EXECUTION_ID);
    expect(job?.workflow_run_id).toBe(WORKFLOW_RUN_ID);
    expect(job?.workflow_run_attempt_id).toBe(WORKFLOW_RUN_ATTEMPT_ID);
    expect(job?.lease_token).toBe('lease-xyz');
    // The claim is step-less: no job_name / steps are required to parse.
    expect(job).not.toHaveProperty('steps');
    expect(job).not.toHaveProperty('job_name');
    expect(calls[0]?.url).toContain('runners/jobs/request');
    expect(calls[0]?.authorization).toBe('Bearer session-abc');
  });

  it('requestJob returns null on 204', async () => {
    stubFetch(() => new Response(null, {status: 204}));

    const job = await requestJob('session-abc');

    expect(job).toBeNull();
  });

  it('requestJob treats the session-exhausted 409 code as terminal', async () => {
    stubFetch(() => jsonResponse({code: RUNNER_SESSION_EXHAUSTED_CODE}, 409));

    const request = requestJob('session-abc');

    await expect(request).rejects.toThrow(RunnerSessionExhaustedError);
  });

  it('requestJob rethrows non-terminal 409 responses as transient', async () => {
    stubFetch(() => jsonResponse({code: 'other-conflict'}, 409));

    const request = requestJob('session-abc');

    await expect(request).rejects.toThrow(HTTPError);
  });

  it('requestJob rethrows malformed 409 responses as transient', async () => {
    stubFetch(() => new Response('not json', {status: 409}));

    const request = requestJob('session-abc');

    await expect(request).rejects.toThrow(HTTPError);
  });

  it('heartbeat sends the job lease token', async () => {
    stubFetch(() => jsonResponse({cancel: false, lease_token: 'lease-next'}));

    const response = await heartbeat(JOB_ID, 'lease-heartbeat');

    expect(response.lease_token).toBe('lease-next');
    expect(calls[0]?.url).toContain(`runners/jobs/${JOB_ID}/heartbeat`);
    expect(calls[0]?.authorization).toBe('Bearer lease-heartbeat');
  });

  it('requestNextStep sends the lease token, not the runner registration token', async () => {
    stubFetch(() => jsonResponse({kind: 'done', status: 'succeeded'}));
    const leaseClient = createLeaseClient('lease-abc');

    const next = await requestNextStep(leaseClient);

    expect(next).toEqual({kind: 'done', status: 'succeeded'});
    expect(calls[0]?.url).toContain('runs/jobs/current/steps/next');
    expect(calls[0]?.authorization).toBe('Bearer lease-abc');
  });

  it('lease clients read rotated lease tokens before each request', async () => {
    stubFetch(() => jsonResponse({kind: 'done', status: 'succeeded'}));
    let leaseToken = 'lease-initial';
    const leaseClient = createLeaseClient(() => leaseToken);

    await requestNextStep(leaseClient);
    leaseToken = 'lease-next';
    await requestNextStep(leaseClient);

    expect(calls.map((call) => call.authorization)).toEqual([
      'Bearer lease-initial',
      'Bearer lease-next',
    ]);
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

  it('requestAgentRuntimeConfig sends the lease token and parses credentials', async () => {
    stubFetch(() =>
      jsonResponse({
        model_provider_id: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        credentials: {api_key: 'sk-runtime'},
      }),
    );
    const leaseClient = createLeaseClient('lease-runtime');

    const runtimeConfig = await requestAgentRuntimeConfig(leaseClient, {
      stepId: STEP_ID,
      attempt: 2,
    });

    expect(runtimeConfig.credentials.api_key).toBe('sk-runtime');
    expect(calls[0]?.url).toContain('runs/jobs/current/agent-runtime-config');
    expect(calls[0]?.url).toContain(`step_id=${STEP_ID}`);
    expect(calls[0]?.url).toContain('attempt=2');
    expect(calls[0]?.authorization).toBe('Bearer lease-runtime');
  });

  it('requestAgentRuntimeConfig maps server config errors to agent config issues', async () => {
    stubFetch(() => jsonResponse({code: 'model-provider-not-configured'}, 409));
    const leaseClient = createLeaseClient('lease-runtime');

    const request = requestAgentRuntimeConfig(leaseClient, {
      stepId: STEP_ID,
      attempt: 2,
    });

    await expect(request).rejects.toMatchObject(
      new AgentRuntimeConfigRequestError(
        409,
        'model-provider-not-configured',
        'model_provider_not_configured',
      ),
    );
  });

  it('requestAgentRuntimeConfig retries transient 429 and 5xx responses', async () => {
    const responses = [
      new Response(null, {status: 429}),
      new Response(null, {status: 500}),
      jsonResponse({
        model_provider_id: 'openai',
        model: 'gpt-5.1',
        thinking: 'medium',
        credentials: {api_key: 'sk-runtime'},
      }),
    ];
    stubFetch(() => responses.shift() ?? new Response(null, {status: 500}));
    const leaseClient = createLeaseClient('lease-runtime');

    const runtimeConfig = await requestAgentRuntimeConfig(leaseClient, {
      stepId: STEP_ID,
      attempt: 2,
    });

    expect(runtimeConfig.model_provider_id).toBe('openai');
    expect(calls).toHaveLength(3);
  });

  it('requestAgentRuntimeConfig surfaces transient retry exhaustion as a typed request error', async () => {
    stubFetch(() => jsonResponse({code: 'temporarily-unavailable'}, 503));
    const leaseClient = createLeaseClient('lease-runtime');

    const request = requestAgentRuntimeConfig(leaseClient, {
      stepId: STEP_ID,
      attempt: 2,
    });

    await expect(request).rejects.toMatchObject(
      new AgentRuntimeConfigRequestError(503, 'temporarily-unavailable'),
    );
    expect(calls).toHaveLength(3);
  });

  it('requestAgentRuntimeConfig classifies malformed success bodies without leaking Zod text', async () => {
    stubFetch(() =>
      jsonResponse({model_provider_id: 'openai', credentials: {api_key: 'sk-runtime'}}),
    );
    const leaseClient = createLeaseClient('lease-runtime');

    const request = requestAgentRuntimeConfig(leaseClient, {
      stepId: STEP_ID,
      attempt: 2,
    });

    await expect(request).rejects.toMatchObject(
      new AgentRuntimeConfigRequestError(200, 'agent-runtime-config-invalid'),
    );
    await expect(request).rejects.not.toThrow(ZOD_ERROR_TEXT_REGEX);
  });

  it.each([
    ['empty', ''],
    ['invalid JSON', 'not json'],
  ])('requestAgentRuntimeConfig classifies %s success bodies as invalid runtime config', async (_caseName, body) => {
    stubFetch(() => new Response(body, {status: 200}));
    const leaseClient = createLeaseClient('lease-runtime');

    const request = requestAgentRuntimeConfig(leaseClient, {
      stepId: STEP_ID,
      attempt: 2,
    });

    await expect(request).rejects.toMatchObject(
      new AgentRuntimeConfigRequestError(200, 'agent-runtime-config-invalid'),
    );
    await expect(request).rejects.not.toThrow(SyntaxError);
  });

  it('reportStep sends the lease token to the per-step report endpoint', async () => {
    stubFetch(() => jsonResponse({ok: true, cancel: false}));
    const leaseClient = createLeaseClient('lease-def');

    const result = await reportStep(leaseClient, {
      stepId: STEP_ID,
      attempt: 1,
      status: 'succeeded',
      exitCode: 0,
      logOutcome: 'drained',
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
    job_execution_id: JOB_EXECUTION_ID,
    workflow_run_id: WORKFLOW_RUN_ID,
    workflow_run_attempt_id: WORKFLOW_RUN_ATTEMPT_ID,
    lease_token: 'lease-xyz',
  };
}

function registerResponse() {
  return {
    session_token: 'session-abc',
    session_id: SESSION_ID,
    mode: 'manual',
    max_claims: null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

function stubFetch(handler: (url: string) => Response): void {
  globalThis.fetch = vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    calls.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get('authorization'),
      body: await request.clone().text(),
    });
    return handler(request.url);
  }) as unknown as typeof globalThis.fetch;
}
