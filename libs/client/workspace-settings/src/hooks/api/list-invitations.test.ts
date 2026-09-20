import {configureApiClient} from '@shipfox/client-api';
import {listInvitations} from './list-invitations.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
  });
}

describe('list invitations adapter', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('requests every open invitation in the workspace scope', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        invitations: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            workspace_id: WORKSPACE_ID,
            email: 'invitee@example.com',
            expires_at: '2026-08-01T00:00:00.000Z',
            accepted_at: null,
            invited_by_user_id: '33333333-3333-4333-8333-333333333333',
            invited_by_display: 'Owner',
            created_at: '2026-07-01T00:00:00.000Z',
            updated_at: '2026-07-01T00:00:00.000Z',
          },
        ],
      }),
    );
    configureApiClient({fetchImpl});

    await expect(listInvitations(WORKSPACE_ID)).resolves.toHaveLength(1);

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect({method: request.method, url: request.url}).toEqual({
      method: 'GET',
      url: `https://api.example.test/workspaces/${WORKSPACE_ID}/invitations`,
    });
  });
});
