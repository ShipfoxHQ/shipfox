import {configureApiClient} from '@shipfox/client-api';
import {
  createManualRegistrationToken,
  revokeManualRegistrationToken,
} from './manual-registration-tokens.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

describe('createManualRegistrationToken', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('posts token creation body', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse(
        {
          id: '44444444-4444-4444-8444-444444444444',
          raw_token: 'sf_mrt_raw-created-token',
          prefix: 'sf_mrt_raw-c',
          name: 'Local runner',
          workspace_id: '11111111-1111-4111-8111-111111111111',
          expires_at: '2026-05-09T00:00:00.000Z',
          created_at: '2026-05-08T00:00:00.000Z',
        },
        {status: 201},
      );
    });
    configureApiClient({fetchImpl});
    const command = {
      name: 'Local runner',
      expiration: {kind: 'expires-after' as const, seconds: 86_400},
    };

    const result = await createManualRegistrationToken({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      command,
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.token).toBe('sf_mrt_raw-created-token');
    expect(request.url).toBe(
      'https://api.example.test/workspaces/11111111-1111-4111-8111-111111111111/runners/manual-registration-tokens',
    );
    expect(request.method).toBe('POST');
    expect(requestBody).toEqual({name: 'Local runner', ttl_seconds: 86_400});
  });
});

describe('revokeManualRegistrationToken', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('posts to the token revoke endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        id: '33333333-3333-4333-8333-333333333333',
        workspace_id: '11111111-1111-4111-8111-111111111111',
        prefix: 'sf_mrt_abcde',
        name: 'Deploy runner',
        expires_at: '2026-05-09T00:00:00.000Z',
        revoked_at: '2026-05-08T01:00:00.000Z',
        created_at: '2026-05-08T00:00:00.000Z',
        updated_at: '2026-05-08T01:00:00.000Z',
      }),
    );
    configureApiClient({fetchImpl});

    const result = await revokeManualRegistrationToken({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      tokenId: '33333333-3333-4333-8333-333333333333',
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.revokedAt).toBe('2026-05-08T01:00:00.000Z');
    expect(request.url).toBe(
      'https://api.example.test/workspaces/11111111-1111-4111-8111-111111111111/runners/manual-registration-tokens/33333333-3333-4333-8333-333333333333/revoke',
    );
    expect(request.method).toBe('POST');
  });
});
