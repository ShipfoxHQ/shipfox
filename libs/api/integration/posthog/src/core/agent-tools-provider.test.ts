import {StreamableHTTPError} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {type CallToolResult, ErrorCode, McpError} from '@modelcontextprotocol/sdk/types.js';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {PosthogInstallation} from '#db/installations.js';
import {posthogAgentToolCatalog, posthogAgentToolSelectionCatalog} from './agent-tools.js';
import {PosthogAgentToolsProvider} from './agent-tools-provider.js';
import {PosthogIntegrationProviderError} from './errors.js';

function posthogConnection(): IntegrationConnection<'posthog'> {
  const now = new Date();
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    provider: 'posthog',
    externalAccountId: 'eu:project-1',
    slug: 'posthog-main',
    displayName: 'PostHog',
    lifecycleStatus: 'active',
    repositoryAccessMode: 'selected',
    createdAt: now,
    updatedAt: now,
  };
}

function installation(region: PosthogInstallation['region'] = 'eu'): PosthogInstallation {
  const now = new Date();
  return {
    connectionId: posthogConnection().id,
    region,
    projectId: 'project-1',
    projectName: 'Analytics',
    organizationId: 'organization-1',
    keyHint: '1234',
    credentialVersion: 3,
    createdAt: now,
    updatedAt: now,
  };
}

function providerOptions(overrides: Record<string, unknown> = {}) {
  const currentInstallation = installation();
  return {
    credentialStore: {getApiKey: vi.fn().mockResolvedValue('phx_secret')},
    getInstallationByConnectionId: vi.fn().mockResolvedValue(currentInstallation),
    api: {probeCredential: vi.fn().mockResolvedValue({status: 200})},
    markConnectionError: vi.fn().mockResolvedValue(undefined),
    createClient: vi.fn().mockResolvedValue({
      callTool: vi.fn().mockResolvedValue({content: []}),
      close: vi.fn().mockResolvedValue(undefined),
    }),
    ...overrides,
  };
}

async function openSession(options: ReturnType<typeof providerOptions>) {
  const provider = new PosthogAgentToolsProvider(options);
  return await provider.openSession({
    connection: posthogConnection(),
    tools: [],
    scope: {provider: 'posthog'},
  });
}

describe('PosthogAgentToolsProvider', () => {
  it('exposes exactly the read-only catalog and selection catalog', () => {
    const provider = new PosthogAgentToolsProvider(providerOptions());

    expect(provider.catalog()).toBe(posthogAgentToolCatalog);
    expect(provider.selectionCatalog()).toBe(posthogAgentToolSelectionCatalog);
    expect(provider.catalog()).toHaveLength(19);
    expect(provider.catalog().every((tool) => tool.requiredScope === 'read')).toBe(true);
    expect(provider.catalog().every((tool) => tool.sensitivity === 'read')).toBe(true);
  });

  it('uses the regional endpoint, bearer key, client identity, and all PostHog headers', async () => {
    const options = providerOptions();
    const session = await openSession(options);
    await session.close?.();

    expect(options.createClient).toHaveBeenCalledWith({
      endpoint: new URL('https://mcp-eu.posthog.com/mcp'),
      accessToken: 'phx_secret',
      headers: {
        'x-posthog-mcp-mode': 'tools',
        'x-posthog-read-only': 'true',
        'x-posthog-project-id': 'project-1',
        'x-posthog-organization-id': 'organization-1',
      },
    });
  });

  it('selects the US MCP endpoint for US installations', async () => {
    const options = providerOptions({
      getInstallationByConnectionId: vi.fn().mockResolvedValue(installation('us')),
    });
    await openSession(options);

    expect(options.createClient).toHaveBeenCalledWith(
      expect.objectContaining({endpoint: new URL('https://mcp.posthog.com/mcp')}),
    );
  });

  it('maps transport failures without copying Linear execution behavior', async () => {
    const options = providerOptions({
      createClient: vi.fn().mockRejectedValue(new StreamableHTTPError(403, 'insufficient scope')),
    });

    await expect(openSession(options)).rejects.toMatchObject({
      reason: 'provider-rejected',
      status: 403,
    });
    expect(options.markConnectionError).not.toHaveBeenCalled();
  });

  it('passes an isError result through as an unstructured generic tool error', async () => {
    const result = {
      isError: true,
      content: [{type: 'text', text: 'Error: [execute-sql]: Retry after 10 seconds'}],
    } satisfies CallToolResult;
    const callTool = vi.fn().mockResolvedValue(result);
    const options = providerOptions({
      createClient: vi.fn().mockResolvedValue({callTool, close: vi.fn()}),
    });
    const session = await openSession(options);

    await expect(
      session.call({toolId: 'execute-sql', arguments: {query: 'SELECT 1'}}),
    ).resolves.toEqual(result);
    expect(options.api.probeCredential).not.toHaveBeenCalled();
  });

  it('probes an INVALID_API_KEY hint and marks only when the probe returns 401', async () => {
    const result = {
      isError: true,
      content: [{type: 'text', text: 'Error: [execute-sql]: INVALID_API_KEY: revoked'}],
    } satisfies CallToolResult;
    const callTool = vi.fn().mockResolvedValue(result);
    const options = providerOptions({
      createClient: vi.fn().mockResolvedValue({callTool, close: vi.fn()}),
    });
    options.api.probeCredential.mockResolvedValue({status: 401});
    const session = await openSession(options);

    await session.call({toolId: 'execute-sql', arguments: {query: 'SELECT 1'}});

    expect(options.api.probeCredential).toHaveBeenCalledWith({region: 'eu', apiKey: 'phx_secret'});
    expect(options.markConnectionError).toHaveBeenCalledWith({
      connectionId: posthogConnection().id,
      credentialVersion: 3,
    });
  });

  it('does not mark a connection when the credential probe returns 200', async () => {
    const result = {
      isError: true,
      content: [{type: 'text', text: 'Error: [execute-sql]: INVALID_API_KEY: transient'}],
    } satisfies CallToolResult;
    const options = providerOptions({
      createClient: vi.fn().mockResolvedValue({
        callTool: vi.fn().mockResolvedValue(result),
        close: vi.fn(),
      }),
    });
    const session = await openSession(options);

    await session.call({toolId: 'execute-sql', arguments: {query: 'SELECT 1'}});

    expect(options.markConnectionError).not.toHaveBeenCalled();
  });

  it('marks a credential rejected during session initialization', async () => {
    const options = providerOptions({
      createClient: vi.fn().mockRejectedValue(new StreamableHTTPError(401, 'Invalid API key')),
    });

    await expect(openSession(options)).rejects.toMatchObject({reason: 'credentials-unavailable'});
    expect(options.markConnectionError).toHaveBeenCalledWith({
      connectionId: posthogConnection().id,
      credentialVersion: 3,
    });
  });

  it.each([
    [new StreamableHTTPError(500, 'outage'), {reason: 'provider-unavailable', status: 500}],
    [new StreamableHTTPError(429, 'rate limit'), {reason: 'rate-limited', status: 429}],
    [new McpError(ErrorCode.RequestTimeout, 'timeout'), {reason: 'timeout'}],
  ])('maps transport errors', async (error, expected) => {
    const options = providerOptions({createClient: vi.fn().mockRejectedValue(error)});

    await expect(openSession(options)).rejects.toMatchObject(expected);
    await expect(openSession(options)).rejects.toBeInstanceOf(PosthogIntegrationProviderError);
  });
});
