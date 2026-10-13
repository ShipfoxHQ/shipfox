import {mintInstallationProvisionerToken} from './provisioner-token.js';

const token = {
  id: '00000000-0000-4000-8000-000000000001',
  scope: 'installation',
  prefix: 'sf_pt_test',
  name: 'E2E',
  status: 'active',
  created_by_user_id: '00000000-0000-4000-8000-000000000002',
  revoked_by_user_id: null,
  expires_at: null,
  revoked_at: null,
  last_seen_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  raw_token: 'sf_pt_raw',
  correlation_id: 'correlation-id',
};

describe('mintInstallationProvisionerToken', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the administrator route and an idempotency key', async () => {
    const fetch = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(token), {
          status: 201,
          headers: {'content-type': 'application/json'},
        }),
    );
    vi.stubGlobal('fetch', fetch);

    await mintInstallationProvisionerToken({
      adminToken: 'admin-token',
      name: 'E2E',
      reason: 'browser denial test',
      idempotencyKey: 'e2e-run-1',
    });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toContain('/admin/runners/provisioner-tokens');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer admin-token');
    expect(headers.get('idempotency-key')).toBe('e2e-run-1');
    expect(JSON.parse(String(init?.body))).toEqual({
      name: 'E2E',
      reason: 'browser denial test',
    });
  });
});
