import type {IntegrationConnectionDto} from '@shipfox/api-integration-core-dto';
import {configureApiClient} from '@shipfox/client-api';
import {listSourceConnections} from './integrations.js';

function connection(overrides: Partial<IntegrationConnectionDto> = {}): IntegrationConnectionDto {
  return {
    id: 'c1',
    workspace_id: 'ws-1',
    provider: 'github',
    external_account_id: 'acct',
    display_name: 'GitHub',
    lifecycle_status: 'active',
    capabilities: ['source_control'],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
  });
}

describe('listSourceConnections', () => {
  test('requests the source_control capability and drops non-active connections', async () => {
    let requestedUrl = '';
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      requestedUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return Promise.resolve(
        jsonResponse({
          connections: [
            connection({id: 'active-1', lifecycle_status: 'active'}),
            connection({id: 'disabled-1', lifecycle_status: 'disabled'}),
            connection({id: 'error-1', lifecycle_status: 'error'}),
          ],
        }),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const result = await listSourceConnections({workspaceId: 'ws-1'});

    expect(requestedUrl).toContain('capability=source_control');
    expect(result.connections.map((connection) => connection.id)).toEqual(['active-1']);
  });
});
