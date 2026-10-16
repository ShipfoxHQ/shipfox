import {StreamableHTTPError} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {type CallToolResult, ErrorCode, McpError} from '@modelcontextprotocol/sdk/types.js';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {ClaapInstallation} from '#db/installations.js';
import {claapAgentToolCatalog, claapAgentToolSelectionCatalog} from './agent-tools.js';
import {ClaapAgentToolsProvider, rewriteClaapCall} from './agent-tools-provider.js';
import {ClaapIntegrationProviderError} from './errors.js';

const otherWorkspaceMessage = /another Claap workspace.*Mercateam/;

function claapConnection(): IntegrationConnection<'claap'> {
  const now = new Date();
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    provider: 'claap',
    externalAccountId: 'q2IqD9wUHb',
    slug: 'claap_mercateam',
    displayName: 'Claap Mercateam',
    lifecycleStatus: 'active',
    repositoryAccessMode: 'selected',
    createdAt: now,
    updatedAt: now,
  };
}

function installation(): ClaapInstallation {
  const now = new Date();
  return {
    connectionId: claapConnection().id,
    workspaceId: 'q2IqD9wUHb',
    workspaceName: 'Mercateam',
    keyHint: '1234',
    credentialVersion: 3,
    createdAt: now,
    updatedAt: now,
  };
}

function providerOptions(overrides: Record<string, unknown> = {}) {
  return {
    credentialStore: {getApiKey: vi.fn().mockResolvedValue('cla_secret')},
    getInstallationByConnectionId: vi.fn().mockResolvedValue(installation()),
    markConnectionError: vi.fn().mockResolvedValue(undefined),
    createClient: vi.fn().mockResolvedValue({
      callTool: vi.fn().mockResolvedValue({content: []}),
      close: vi.fn().mockResolvedValue(undefined),
    }),
    ...overrides,
  };
}

async function openSession(options: ReturnType<typeof providerOptions>) {
  const provider = new ClaapAgentToolsProvider(options);
  return await provider.openSession({
    connection: claapConnection(),
    tools: [],
    scope: {provider: 'claap'},
  });
}

describe('ClaapAgentToolsProvider', () => {
  it('exposes exactly the read-only catalog and selection catalog', () => {
    const provider = new ClaapAgentToolsProvider(providerOptions());

    expect(provider.catalog()).toBe(claapAgentToolCatalog);
    expect(provider.selectionCatalog()).toBe(claapAgentToolSelectionCatalog);
    expect(provider.catalog()).toHaveLength(5);
    expect(provider.catalog().every((tool) => tool.requiredScope === 'read')).toBe(true);
    expect(provider.catalog().every((tool) => tool.sensitivity === 'read')).toBe(true);
  });

  it('opens a session on the default endpoint with the stored key', async () => {
    const options = providerOptions();
    const session = await openSession(options);
    await session.close?.();

    expect(options.createClient).toHaveBeenCalledWith({
      endpoint: new URL('https://api.claap.io/mcp'),
      apiKey: 'cla_secret',
    });
  });

  it('uses the configured endpoint', async () => {
    const options = providerOptions({endpoint: 'http://localhost:4020/mcp'});
    await openSession(options);

    expect(options.createClient).toHaveBeenCalledWith(
      expect.objectContaining({endpoint: new URL('http://localhost:4020/mcp')}),
    );
  });

  it('injects the connection workspace into a workspace-scoped call and returns the result unchanged', async () => {
    const result = {content: [{type: 'text', text: '{"total":0,"recordings":[]}'}]};
    const callTool = vi.fn().mockResolvedValue(result);
    const options = providerOptions({
      createClient: vi.fn().mockResolvedValue({callTool, close: vi.fn()}),
    });
    const session = await openSession(options);

    await expect(session.call({toolId: 'get_recordings', arguments: {limit: 5}})).resolves.toEqual(
      result,
    );

    expect(callTool).toHaveBeenCalledWith(
      {toolId: 'get_recordings', arguments: {limit: 5, workspaceId: 'q2IqD9wUHb'}},
      30_000,
    );
  });

  it('passes an isError result through unchanged and leaves the connection active', async () => {
    const result = {
      isError: true,
      content: [{type: 'text', text: 'not_found'}],
    } satisfies CallToolResult;
    const options = providerOptions({
      createClient: vi.fn().mockResolvedValue({
        callTool: vi.fn().mockResolvedValue(result),
        close: vi.fn(),
      }),
    });
    const session = await openSession(options);

    await expect(
      session.call({toolId: 'get_recording', arguments: {recordingId: 'rec1'}}),
    ).resolves.toEqual(result);
    expect(options.markConnectionError).not.toHaveBeenCalled();
  });

  it('refuses a tool outside the catalog without calling Claap', async () => {
    const callTool = vi.fn();
    const options = providerOptions({
      createClient: vi.fn().mockResolvedValue({callTool, close: vi.fn()}),
    });
    const session = await openSession(options);

    await expect(
      session.call({toolId: 'update_deal', arguments: {dealId: 'deal1'}}),
    ).rejects.toMatchObject({reason: 'provider-rejected'});
    expect(callTool).not.toHaveBeenCalled();
  });

  it('marks a credential rejected during session initialization under the version guard', async () => {
    const options = providerOptions({
      createClient: vi.fn().mockRejectedValue(new StreamableHTTPError(401, 'Invalid API key')),
    });

    await expect(openSession(options)).rejects.toMatchObject({reason: 'credentials-unavailable'});
    expect(options.markConnectionError).toHaveBeenCalledWith({
      connectionId: claapConnection().id,
      credentialVersion: 3,
    });
  });

  it('maps a 403 at initialization without marking the connection', async () => {
    const options = providerOptions({
      createClient: vi.fn().mockRejectedValue(new StreamableHTTPError(403, 'forbidden')),
    });

    await expect(openSession(options)).rejects.toMatchObject({
      reason: 'provider-rejected',
      status: 403,
    });
    expect(options.markConnectionError).not.toHaveBeenCalled();
  });

  it('maps call-time rate limits to a typed provider error', async () => {
    const callTool = vi.fn().mockRejectedValue(new StreamableHTTPError(429, 'rate limit'));
    const options = providerOptions({
      createClient: vi.fn().mockResolvedValue({callTool, close: vi.fn()}),
    });
    const session = await openSession(options);

    const call = session.call({toolId: 'get_recordings', arguments: {}});
    await expect(call).rejects.toMatchObject({reason: 'rate-limited', status: 429});
    await expect(call).rejects.toBeInstanceOf(ClaapIntegrationProviderError);
  });

  it.each([
    [new StreamableHTTPError(500, 'outage'), {reason: 'provider-unavailable', status: 500}],
    [new StreamableHTTPError(429, 'rate limit'), {reason: 'rate-limited', status: 429}],
    [new StreamableHTTPError(408, 'timeout'), {reason: 'timeout', status: 408}],
    [new McpError(ErrorCode.RequestTimeout, 'timeout'), {reason: 'timeout'}],
    [new McpError(ErrorCode.InvalidParams, 'bad'), {reason: 'provider-rejected'}],
  ])('maps transport errors', async (error, expected) => {
    const options = providerOptions({createClient: vi.fn().mockRejectedValue(error)});

    await expect(openSession(options)).rejects.toMatchObject(expected);
    await expect(openSession(options)).rejects.toBeInstanceOf(ClaapIntegrationProviderError);
  });
});

describe('rewriteClaapCall', () => {
  const target = {workspaceId: 'q2IqD9wUHb', workspaceName: 'Mercateam'};

  it.each([
    'get_recordings',
    'search_recording_transcripts',
  ])('injects workspaceId into %s and overrides a caller value', (toolId) => {
    expect(
      rewriteClaapCall({
        call: {toolId, arguments: {workspaceId: 'attacker', limit: 3}},
        installation: target,
      }),
    ).toEqual({toolId, arguments: {limit: 3, workspaceId: 'q2IqD9wUHb'}});
  });

  it('sends list_workspaces with empty arguments', () => {
    expect(
      rewriteClaapCall({
        call: {toolId: 'list_workspaces', arguments: {workspaceId: 'attacker', extra: true}},
        installation: target,
      }),
    ).toEqual({toolId: 'list_workspaces', arguments: {}});
  });

  it.each([
    'get_recording',
    'get_recording_transcript',
  ])('sends the recording ID of a share URL to %s and drops the URL', (toolId) => {
    expect(
      rewriteClaapCall({
        call: {
          toolId,
          arguments: {recordingUrl: 'https://app.claap.io/call-c-q2IqD9wUHb-rec1?t=3'},
        },
        installation: target,
      }),
    ).toEqual({toolId, arguments: {recordingId: 'rec1', workspaceId: 'q2IqD9wUHb'}});
  });

  it('passes a recording ID through', () => {
    expect(
      rewriteClaapCall({
        call: {toolId: 'get_recording', arguments: {recordingId: 'rec1'}},
        installation: target,
      }),
    ).toEqual({
      toolId: 'get_recording',
      arguments: {recordingId: 'rec1', workspaceId: 'q2IqD9wUHb'},
    });
  });

  it('rejects a share URL from another Claap workspace and names the connected one', () => {
    expect(() =>
      rewriteClaapCall({
        call: {
          toolId: 'get_recording',
          arguments: {recordingUrl: 'https://app.claap.io/call-c-otherWs-rec1'},
        },
        installation: target,
      }),
    ).toThrow(otherWorkspaceMessage);
  });

  it.each([
    [{}],
    [{recordingId: 'rec1', recordingUrl: 'https://app.claap.io/call-c-q2IqD9wUHb-rec1'}],
    [{recordingUrl: 'https://example.com/call-c-q2IqD9wUHb-rec1'}],
    [{recordingUrl: 42}],
    [{recordingId: ''}],
  ])('rejects arguments that do not name exactly one valid recording: %j', (args) => {
    expect(() =>
      rewriteClaapCall({
        call: {toolId: 'get_recording_transcript', arguments: args},
        installation: target,
      }),
    ).toThrow(ClaapIntegrationProviderError);
  });

  it('does not forward a recordingUrl argument to a tool that does not take one', () => {
    expect(
      rewriteClaapCall({
        call: {toolId: 'get_recordings', arguments: {recordingUrl: 'x'}},
        installation: target,
      }),
    ).toEqual({toolId: 'get_recordings', arguments: {workspaceId: 'q2IqD9wUHb'}});
  });
});
