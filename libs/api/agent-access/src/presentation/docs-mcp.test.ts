import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {CallToolResultSchema, ErrorCode} from '@modelcontextprotocol/sdk/types.js';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import {createDocsCache} from '#core/docs.js';
import {createSearchDocsTool} from '#core/docs-tools.js';
import {createAgentAccessRateLimiter} from '#core/rate-limiter.js';
import {buildAgentAccessMcpServer} from './mcp-server.js';

const context: AgentAccessContext = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  credential: {kind: 'oauth_grant', grantId: 'grant-1', clientId: 'client-1'},
};
const index = '- [How Shipfox works](https://docs.example.test/docs/understand): Introduction.\n';

async function connect(params: Parameters<typeof buildAgentAccessMcpServer>[0]) {
  const server = buildAgentAccessMcpServer(params);
  const client = new Client({name: 'docs-test', version: '1'});
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

describe('documentation MCP surface', () => {
  test('lists only the index and a page template, reads hits, and audits misses', async () => {
    const recordCall = vi.fn();
    const fetcher = vi.fn((target: URL) => {
      if (target.pathname.endsWith('llms.txt')) return new Response(index);
      if (target.pathname.endsWith('llms.mdx/understand'))
        return new Response('# How Shipfox works');
      throw new Error(`Unexpected URL ${target}`);
    });
    const docs = createDocsCache({
      baseUrl: 'https://docs.example.test/docs',
      fetch: fetcher as unknown as typeof fetch,
    });
    const {client, close} = await connect({
      context,
      docs,
      tools: [createSearchDocsTool(docs)],
      recordCall,
    });
    const resources = await client.listResources();
    expect(client.getInstructions()).toContain('Use search_docs to find a page');
    expect(resources.resources.map(({uri}) => uri)).toContain('docs://shipfox/index');
    expect(resources.resources.map(({uri}) => uri)).not.toContain('docs://shipfox/understand');
    expect(
      resources.resources.find(({uri}) => uri === 'docs://shipfox/index')?.annotations?.audience,
    ).toEqual(['assistant']);
    expect((await client.listResourceTemplates()).resourceTemplates).toEqual([
      expect.objectContaining({uriTemplate: 'docs://shipfox/{slug}'}),
    ]);
    expect((await client.readResource({uri: 'docs://shipfox/index'})).contents[0]).toMatchObject({
      text: index,
    });
    expect(recordCall).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'resource',
        source: 'docs',
        slug: 'index',
        cached: false,
        outcome: 'success',
      }),
    );
    expect(
      (await client.readResource({uri: 'docs://shipfox/understand'})).contents[0],
    ).toMatchObject({
      text: '# How Shipfox works',
      mimeType: 'text/markdown',
    });
    await expect(client.readResource({uri: 'docs://shipfox/missing'})).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
      data: {uri: 'docs://shipfox/missing'},
    });
    await expect(client.readResource({uri: 'docs://shipfox/../secret'})).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
    });
    expect(recordCall).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'resource',
        source: 'docs',
        slug: 'understand',
        cached: false,
        outcome: 'success',
      }),
    );
    expect(recordCall).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'resource',
        source: 'docs',
        slug: 'missing',
        outcome: 'invalid-request',
      }),
    );
    await close();
  });

  test('charges uncached reads and search in the same rate window', async () => {
    const fetcher = vi.fn((target: URL) => {
      if (target.pathname.endsWith('llms.txt')) return new Response(index);
      if (target.pathname.endsWith('llms.mdx/understand'))
        return new Response('# How Shipfox works');
      if (target.pathname.endsWith('api/search'))
        return new Response(
          JSON.stringify([{url: '/understand', content: 'How <mark>Shipfox</mark> works'}]),
        );
      throw new Error(`Unexpected URL ${target}`);
    });
    const docs = createDocsCache({
      baseUrl: 'https://docs.example.test/docs',
      fetch: fetcher as unknown as typeof fetch,
    });
    await docs.readIndex();
    const rateLimiter = createAgentAccessRateLimiter({limit: 1});
    const {client, close} = await connect({
      context,
      docs,
      rateLimiter,
      tools: [createSearchDocsTool(docs)],
    });
    expect((await client.readResource({uri: 'docs://shipfox/understand'})).contents).toHaveLength(
      1,
    );
    expect((await client.readResource({uri: 'docs://shipfox/understand'})).contents).toHaveLength(
      1,
    );
    const search = await client.callTool(
      {name: 'search_docs', arguments: {query: 'shipfox'}},
      CallToolResultSchema,
    );
    expect(search.structuredContent).toMatchObject({ok: false, error: {code: 'rate-limited'}});
    expect(fetcher).toHaveBeenCalledTimes(2);
    await close();
  });

  test('search maps a page hit and rejects invalid input', async () => {
    const fetcher = vi.fn((target: URL) => {
      if (target.pathname.endsWith('llms.txt')) return new Response(index);
      return new Response(
        JSON.stringify([{url: '/understand', content: 'How <mark>Shipfox</mark> works'}]),
      );
    });
    const docs = createDocsCache({
      baseUrl: 'https://docs.example.test/docs',
      fetch: fetcher as unknown as typeof fetch,
    });
    await docs.readIndex();
    const {client, close} = await connect({context, docs, tools: [createSearchDocsTool(docs)]});
    const search = await client.callTool(
      {name: 'search_docs', arguments: {query: 'shipfox'}},
      CallToolResultSchema,
    );
    expect(search.structuredContent).toEqual({
      ok: true,
      result: {
        hits: [
          {
            slug: 'understand',
            title: 'How Shipfox works',
            excerpt: 'How Shipfox works',
            uri: 'docs://shipfox/understand',
          },
        ],
      },
    });
    const invalid = await client.callTool(
      {name: 'search_docs', arguments: {query: ''}},
      CallToolResultSchema,
    );
    expect(invalid.structuredContent).toMatchObject({ok: false, error: {code: 'invalid-request'}});
    await close();
  });

  test('cold host outage keeps discovery but returns internal errors for reads', async () => {
    const docs = createDocsCache({
      baseUrl: 'https://docs.example.test/docs',
      fetch: vi.fn(() => {
        throw new Error('host down');
      }) as typeof fetch,
    });
    const {client, close} = await connect({context, docs, tools: [createSearchDocsTool(docs)]});
    expect((await client.listResources()).resources.map(({uri}) => uri)).toContain(
      'docs://shipfox/index',
    );
    expect((await client.listResourceTemplates()).resourceTemplates).toHaveLength(1);
    await expect(client.readResource({uri: 'docs://shipfox/index'})).rejects.toMatchObject({
      code: ErrorCode.InternalError,
    });
    await close();
  });

  test('disabled docs expose neither resources nor search', async () => {
    const docs = createDocsCache({baseUrl: ''});
    const {client, close} = await connect({context, docs, tools: []});
    expect((await client.listResources()).resources.map(({uri}) => uri)).not.toContain(
      'docs://shipfox/index',
    );
    expect((await client.listResourceTemplates()).resourceTemplates).toEqual([]);
    expect(client.getInstructions()).not.toContain('search_docs');
    expect((await client.listTools()).tools.map(({name}) => name)).not.toContain('search_docs');
    await close();
  });
});
