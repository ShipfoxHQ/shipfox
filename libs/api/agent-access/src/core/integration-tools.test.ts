import {
  agentAccessEnvelopeSchema,
  getIntegrationConnectionToolsInputJsonSchema,
  getIntegrationConnectionToolsResultSchema,
} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {decodeStringIdCursor, encodeStringIdCursor} from '@shipfox/node-drizzle';
import {createAgentAccessIntegrationTools} from './integration-tools.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const connectionId = '00000000-0000-4000-8000-000000000002';
const context: AgentAccessContext = {
  userId: '00000000-0000-4000-8000-000000000003',
  workspaceId,
  credential: {
    kind: 'oauth_grant',
    grantId: '00000000-0000-4000-8000-000000000004',
    clientId: 'test',
  },
};
const isoDate = '2026-08-01T00:00:00.000Z';

describe('agent-access integration tools', () => {
  test('lists connections in producer order and forwards the capability and cursor', async () => {
    const client = integrationClient();
    client.listConnectionsByWorkspace
      .mockResolvedValueOnce({
        connections: [connection('github-main', 'GitHub')],
        nextCursor: {slug: 'github-main', id: connectionId},
      })
      .mockResolvedValueOnce({connections: [], nextCursor: null});
    const list = getTool(client, 'list_integration_connections');

    const first = await list.execute({
      context,
      arguments: {capability: 'source_control', limit: 1},
    });
    expect(client.listConnectionsByWorkspace).toHaveBeenCalledWith({
      workspaceId,
      capability: 'source_control',
      limit: 1,
    });
    expect(first).toMatchObject({
      ok: true,
      result: {
        connections: [{slug: 'github-main', display_name: 'GitHub'}],
        next_cursor: expect.any(String),
      },
    });
    if (!first.ok) throw new Error('Expected a successful list response');
    const firstResult = first.result as {next_cursor: string};
    expect(list.validateResult?.(first.result)).toBe(true);
    expect(decodeStringIdCursor(firstResult.next_cursor)).toEqual({
      value: 'github-main',
      id: connectionId,
    });

    const cursor = firstResult.next_cursor;
    await list.execute({context, arguments: {cursor}});
    expect(client.listConnectionsByWorkspace).toHaveBeenLastCalledWith({
      workspaceId,
      limit: 50,
      cursor: {slug: 'github-main', id: connectionId},
    });
  });

  test('rejects an empty slug at the tool boundary', async () => {
    const client = integrationClient();
    const detail = getTool(client, 'get_integration_connection_tools');

    expect(detail.validateInput?.({slug: ''})).toBe(false);
    expect(getIntegrationConnectionToolsInputJsonSchema.oneOf[1].properties.slug.minLength).toBe(1);

    const response = await detail.execute({context, arguments: {slug: ''}});
    expect(response).toEqual({ok: false, error: {code: 'invalid-request'}});
    expect(client.resolveConnection).not.toHaveBeenCalled();
  });

  test('flags catalog caps and never exposes provider schemas', async () => {
    const client = integrationClient();
    client.getConnectionToolCatalog.mockResolvedValue({
      connection: {
        id: connectionId,
        slug: 'github-main',
        provider: 'github',
        displayName: 'D'.repeat(600),
        lifecycleStatus: 'active',
        capabilities: ['source_control', 'agent_tools'],
      },
      tools: Array.from({length: 101}, (_, index) => ({
        id: `tool-${index}`,
        description: 'T'.repeat(600),
        sensitivity: 'read' as const,
        sensitive: false,
        methods: Array.from({length: 51}, (_, methodIndex) => ({
          id: `method-${methodIndex}`,
          description: 'M'.repeat(600),
          sensitivity: 'write' as const,
          sensitive: true,
        })),
      })),
      events: Array.from({length: 101}, (_, index) =>
        index === 0 ? 'E'.repeat(600) : `event-${index}`,
      ),
    });
    const detail = getTool(client, 'get_integration_connection_tools');

    const response = await detail.execute({context, arguments: {connection_id: connectionId}});
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error('Expected a successful detail response');
    expect(getIntegrationConnectionToolsResultSchema.safeParse(response.result).success).toBe(true);
    expect(agentAccessEnvelopeSchema.safeParse(response).success).toBe(true);
    const result = response.result as {
      tools: Array<Record<string, unknown>>;
      tools_truncated?: true;
      events_truncated?: true;
      event_names_truncated?: true;
      connection: Record<string, unknown>;
    };
    expect(result.tools[0]).toMatchObject({
      description_truncated: true,
      methods_truncated: true,
    });
    expect(result).toMatchObject({
      tools_truncated: true,
      events_truncated: true,
      event_names_truncated: true,
      connection: {display_name_truncated: true},
    });
    expect(JSON.stringify(response)).not.toContain('inputSchema');
    expect(JSON.stringify(response)).not.toContain('outputSchema');
  });

  test('reports event-name truncation separately from event-array truncation', async () => {
    const client = integrationClient();
    client.getConnectionToolCatalog.mockResolvedValue({
      connection: {
        id: connectionId,
        slug: 'github-main',
        provider: 'github',
        displayName: 'GitHub',
        lifecycleStatus: 'active',
        capabilities: ['source_control'],
      },
      tools: [],
      events: ['E'.repeat(600)],
    });
    const detail = getTool(client, 'get_integration_connection_tools');

    const response = await detail.execute({context, arguments: {connection_id: connectionId}});
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error('Expected a successful detail response');
    const result = response.result as {
      events_truncated?: true;
      event_names_truncated?: true;
    };
    expect(result).toMatchObject({event_names_truncated: true});
    expect(result).not.toHaveProperty('events_truncated');
  });

  test('resolves a slug in the credential workspace and returns not-found for unknown values', async () => {
    const client = integrationClient();
    client.resolveConnection
      .mockResolvedValueOnce({id: connectionId, provider: 'github', slug: 'github-main'})
      .mockResolvedValueOnce(null);
    client.getConnectionToolCatalog.mockResolvedValue({
      connection: {
        id: connectionId,
        slug: 'github-main',
        provider: 'github',
        displayName: 'GitHub',
        lifecycleStatus: 'disabled',
        capabilities: ['source_control'],
      },
      tools: [],
      events: [],
    });
    const detail = getTool(client, 'get_integration_connection_tools');

    const bySlug = await detail.execute({context, arguments: {slug: 'github-main'}});
    expect(bySlug.ok).toBe(true);
    expect(client.resolveConnection).toHaveBeenNthCalledWith(1, {
      workspaceId,
      slug: 'github-main',
    });
    expect(client.getConnectionToolCatalog).toHaveBeenCalledWith({
      workspaceId,
      connectionId,
    });

    const unknown = await detail.execute({context, arguments: {slug: 'missing'}});
    expect(unknown).toEqual({ok: false, error: {code: 'not-found'}});
    const invalid = await detail.execute({
      context,
      arguments: {slug: 'one', connection_id: connectionId},
    });
    expect(invalid).toEqual({ok: false, error: {code: 'invalid-request'}});
    expect(client.resolveConnection).toHaveBeenNthCalledWith(2, {
      workspaceId,
      slug: 'missing',
    });
  });

  test.each([
    {value: '', id: connectionId},
    {value: 'github-main', id: 'not-a-uuid'},
  ])('rejects malformed list cursor %#', async (cursor) => {
    const client = integrationClient();
    const list = getTool(client, 'list_integration_connections');

    const response = await list.execute({
      context,
      arguments: {cursor: encodeStringIdCursor(cursor)},
    });

    expect(response).toEqual({ok: false, error: {code: 'invalid-request'}});
    expect(client.listConnectionsByWorkspace).not.toHaveBeenCalled();
  });
});

function integrationClient() {
  return {
    listConnectionsByWorkspace: vi.fn<IntegrationsModuleClient['listConnectionsByWorkspace']>(),
    resolveConnection: vi.fn<IntegrationsModuleClient['resolveConnection']>(),
    getConnectionToolCatalog: vi.fn<IntegrationsModuleClient['getConnectionToolCatalog']>(),
  } as unknown as IntegrationsModuleClient & {
    listConnectionsByWorkspace: ReturnType<
      typeof vi.fn<IntegrationsModuleClient['listConnectionsByWorkspace']>
    >;
    resolveConnection: ReturnType<typeof vi.fn<IntegrationsModuleClient['resolveConnection']>>;
    getConnectionToolCatalog: ReturnType<
      typeof vi.fn<IntegrationsModuleClient['getConnectionToolCatalog']>
    >;
  };
}

function getTool(client: IntegrationsModuleClient, name: string) {
  const tool = createAgentAccessIntegrationTools(client).find(
    (candidate) => candidate.name === name,
  );
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

function connection(slug: string, displayName: string) {
  return {
    id: connectionId,
    slug,
    provider: 'github',
    displayName,
    lifecycleStatus: 'active' as const,
    capabilities: ['source_control' as const],
    externalUrl: 'https://github.com/ShipfoxHQ/shipfox',
    createdAt: isoDate,
    updatedAt: isoDate,
  };
}
