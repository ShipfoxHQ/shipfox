import {createProvisionerClient, ProvisionerAuthenticationError} from '#api-client.js';

const BASE_URL = 'https://api.test';
const TOKEN = 'sfpt_test-token';
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const PROVISIONER_ID = '00000000-0000-4000-8000-000000000002';
const RESERVATION_ID = '00000000-0000-4000-8000-000000000003';

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

function client() {
  return createProvisionerClient({baseUrl: BASE_URL, token: TOKEN});
}

describe('createProvisionerClient', () => {
  it('getIdentity sends the provisioner token to /provisioners/me and parses identity', async () => {
    stubFetch(() =>
      jsonResponse({id: PROVISIONER_ID, scope: 'workspace', workspace_id: WORKSPACE_ID}),
    );

    const identity = await client().getIdentity();

    expect(identity).toEqual({id: PROVISIONER_ID, scope: 'workspace', workspace_id: WORKSPACE_ID});
    expect(calls[0]?.url).toContain('provisioners/me');
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('pollDemand posts to /demand/poll with the token and parses the response', async () => {
    stubFetch(() =>
      jsonResponse({stats: [], reservations: [], terminate_provisioned_runner_ids: []}),
    );

    const result = await client().pollDemand({
      wait_seconds: 30,
      max_reservations: 10,
      templates: [
        {template_key: 'small', labels: ['ubuntu22'], available_slots: 5, starting: 0, running: 0},
      ],
    });

    expect(result).toEqual({stats: [], reservations: [], terminate_provisioned_runner_ids: []});
    expect(calls[0]?.url).toContain('provisioners/demand/poll');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('mintRegistrationTokens posts to the batch route with the token and parses tokens', async () => {
    stubFetch(() =>
      jsonResponse({
        tokens: [
          {
            provisioned_runner_id: 'r1',
            registration_token: 'sf_ert_x',
            expires_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    );

    const result = await client().mintRegistrationTokens({
      reservation_id: RESERVATION_ID,
      provisioned_runners: [{provisioned_runner_id: 'r1'}],
    });

    expect(result.tokens[0]?.registration_token).toBe('sf_ert_x');
    expect(calls[0]?.url).toContain('provisioners/runner-registration-tokens/batch');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('reportProvisionedRunners posts lifecycle events with the token and parses the response', async () => {
    stubFetch(() => jsonResponse({accepted: 1, reservations_released: 1}));

    const result = await client().reportProvisionedRunners({
      events: [
        {
          provisioned_runner_id: 'provisioned-runner-1',
          reservation_id: RESERVATION_ID,
          template_key: 'small',
          labels: ['ubuntu22'],
          state: 'running',
          reported_at: '2026-01-01T00:00:00.000Z',
          provider_kind: 'docker',
        },
      ],
    });

    expect(result).toEqual({accepted: 1, reservations_released: 1});
    expect(calls[0]?.url).toContain('provisioners/provisioned-runners/report');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('reconcileProvisionedRunners posts observed ids with the token and parses intent', async () => {
    stubFetch(() =>
      jsonResponse({
        runners: [
          {
            provisioned_runner_id: 'runner-1',
            state: 'running',
            reservation_id: RESERVATION_ID,
            runner_session_id: null,
            bound_job: null,
            desired_intent: 'keep',
          },
        ],
        terminated_absent_provisioned_runner_ids: ['runner-2'],
      }),
    );

    const result = await client().reconcileProvisionedRunners({
      observed_provisioned_runner_ids: ['runner-1'],
    });

    expect(result.runners[0]?.desired_intent).toBe('keep');
    expect(result.terminated_absent_provisioned_runner_ids).toEqual(['runner-2']);
    expect(calls[0]?.url).toContain('provisioners/provisioned-runners/reconcile');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      observed_provisioned_runner_ids: ['runner-1'],
    });
  });

  it('maps a 401 on getIdentity to ProvisionerAuthenticationError', async () => {
    stubFetch(() => new Response(null, {status: 401}));

    await expect(client().getIdentity()).rejects.toThrow(ProvisionerAuthenticationError);
  });

  it('maps a 403 on pollDemand to ProvisionerAuthenticationError', async () => {
    stubFetch(() => new Response(null, {status: 403}));

    const request = client().pollDemand({
      wait_seconds: 0,
      max_reservations: 0,
      templates: [
        {template_key: 'small', labels: ['ubuntu22'], available_slots: 0, starting: 0, running: 0},
      ],
    });

    await expect(request).rejects.toThrow(ProvisionerAuthenticationError);
  });

  it('maps a 403 on reportProvisionedRunners to ProvisionerAuthenticationError', async () => {
    stubFetch(() => new Response(null, {status: 403}));

    const request = client().reportProvisionedRunners({
      events: [
        {
          provisioned_runner_id: 'provisioned-runner-1',
          labels: ['ubuntu22'],
          state: 'running',
          reported_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    await expect(request).rejects.toThrow(ProvisionerAuthenticationError);
  });

  it('maps a 401 on reconcileProvisionedRunners to ProvisionerAuthenticationError', async () => {
    stubFetch(() => new Response(null, {status: 401}));

    const request = client().reconcileProvisionedRunners({
      observed_provisioned_runner_ids: ['runner-1'],
    });

    await expect(request).rejects.toThrow(ProvisionerAuthenticationError);
  });
});

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
