import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {
  catalogTool,
  connection,
  materializedIntegration,
  materializedTool,
} from '#test/agent-tools-gateway-helpers.js';
import {buildAgentToolsMcpServer, type IntegrationToolDispatchInput} from './mcp-server.js';
import type {AuthorizedIntegrationToolMap} from './resolve-authorized-tools.js';

describe('buildAgentToolsMcpServer', () => {
  it('lists namespaced tools and dispatches authorized method-family calls', async () => {
    const dispatch = vi.fn(async (input: IntegrationToolDispatchInput) => ({
      content: [{type: 'text' as const, text: `called:${input.method}`}],
    }));
    const {client, close} = await connectClient(dispatch);

    const tools = await client.listTools();
    const result = await client.callTool(
      {
        name: 'github_main__issue_read',
        arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
      },
      CallToolResultSchema,
    );
    await close();

    expect(tools.tools).toMatchObject([
      {
        name: 'github_main__issue_read',
        description: 'Read issue metadata from GitHub.',
      },
    ]);
    expect(result.isError).not.toBe(true);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'get',
        arguments: expect.objectContaining({issue_number: 1}),
      }),
    );
  });

  it.each([
    ['unknown tool', 'missing__tool', {method: 'get'}],
    ['missing method', 'github_main__issue_read', {}],
    ['non-string method', 'github_main__issue_read', {method: 1}],
    ['unauthorized method', 'github_main__issue_read', {method: 'get_labels'}],
  ])('returns an isError tool result for %s', async (_label, name, args) => {
    const dispatch = vi.fn();
    const {client, close} = await connectClient(dispatch);

    const result = await client.callTool({name, arguments: args}, CallToolResultSchema);
    await close();

    expect(result.isError).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('ignores a stray method argument for standalone tools', async () => {
    const dispatch = vi.fn(async () => ({
      content: [{type: 'text' as const, text: 'called'}],
    }));
    const {client, close} = await connectClient(dispatch, standaloneTools());

    const result = await client.callTool(
      {name: 'github_main__list_issues', arguments: {method: 'ignored'}},
      CallToolResultSchema,
    );
    await close();

    expect(result.isError).not.toBe(true);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: undefined,
        arguments: {method: 'ignored'},
      }),
    );
  });

  it('defaults omitted arguments to an empty object for optional-argument tools', async () => {
    const dispatch = vi.fn(async () => ({
      content: [{type: 'text' as const, text: 'called'}],
    }));
    const {client, close} = await connectClient(dispatch, standaloneTools());

    const result = await client.callTool({name: 'github_main__list_issues'}, CallToolResultSchema);
    await close();

    expect(result.isError).not.toBe(true);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: {},
      }),
    );
  });

  it('rejects arguments that do not match the exposed input schema', async () => {
    const dispatch = vi.fn();
    const {client, close} = await connectClient(dispatch);

    const result = await client.callTool(
      {
        name: 'github_main__issue_read',
        arguments: {
          method: 'get',
          owner: 'shipfox',
          repo: 'platform',
          issue_number: 'not-an-integer',
        },
      },
      CallToolResultSchema,
    );
    await close();

    expect(result.isError).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

async function connectClient(
  dispatch: Parameters<typeof buildAgentToolsMcpServer>[0]['dispatch'],
  authorizedTools = defaultAuthorizedTools(),
) {
  const server = buildAgentToolsMcpServer({authorizedTools, dispatch});
  const client = new Client({name: 'test-client', version: '0.0.0'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function defaultAuthorizedTools(): AuthorizedIntegrationToolMap {
  const integration = materializedIntegration({connectionId: 'connection-1'});
  const tool = materializedTool();
  return new Map([
    [
      'github_main__issue_read',
      {
        mcpName: 'github_main__issue_read',
        integration,
        tool,
        connection: connection({
          id: 'connection-1',
          workspaceId: 'workspace-1',
          slug: integration.connectionSlug,
        }),
        description: catalogTool().description,
        inputSchema: tool.inputSchema,
      },
    ],
  ]);
}

function standaloneTools(): AuthorizedIntegrationToolMap {
  const integration = materializedIntegration({
    connectionId: 'connection-1',
    tools: [
      materializedTool({
        id: 'list_issues',
        methods: undefined,
        inputSchema: {type: 'object', properties: {}, additionalProperties: true},
      }),
    ],
  });
  const [tool] = integration.tools;
  if (!tool) throw new Error('Expected standalone integration tool');

  return new Map([
    [
      'github_main__list_issues',
      {
        mcpName: 'github_main__list_issues',
        integration,
        tool,
        connection: connection({
          id: 'connection-1',
          workspaceId: 'workspace-1',
          slug: integration.connectionSlug,
        }),
        description: 'List issues',
        inputSchema: tool.inputSchema,
      },
    ],
  ]);
}
