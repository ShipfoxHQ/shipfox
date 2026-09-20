import {configureApiClient} from '@shipfox/client-api';
import {listMembers} from './list-members.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
  });
}

describe('list members adapter', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('requests every member in the workspace scope', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        members: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            user_id: '33333333-3333-4333-8333-333333333333',
            workspace_id: WORKSPACE_ID,
            user_email: 'member@example.com',
            user_name: 'Member',
            created_at: '2026-07-01T00:00:00.000Z',
            updated_at: '2026-07-01T00:00:00.000Z',
          },
        ],
      }),
    );
    configureApiClient({fetchImpl});

    await expect(listMembers(WORKSPACE_ID)).resolves.toHaveLength(1);

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect({method: request.method, url: request.url}).toEqual({
      method: 'GET',
      url: `https://api.example.test/workspaces/${WORKSPACE_ID}/members`,
    });
  });
});
