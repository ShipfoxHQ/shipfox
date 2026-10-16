import {StreamableHTTPError} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {type CallToolResult, ErrorCode, McpError} from '@modelcontextprotocol/sdk/types.js';
import {jamConnection, jamInstallation, textResult} from '#test/fixtures/jam.js';
import {jamAgentToolCatalog, jamAgentToolSelectionCatalog} from './agent-tools.js';
import {JamAgentToolsProvider} from './agent-tools-provider.js';
import {JamIntegrationProviderError} from './errors.js';

function providerOptions(overrides: Record<string, unknown> = {}) {
  return {
    credentialStore: {getToken: vi.fn().mockResolvedValue('jam_pat_secret')},
    getInstallationByConnectionId: vi.fn().mockResolvedValue(jamInstallation()),
    markConnectionError: vi.fn().mockResolvedValue(undefined),
    createClient: vi.fn().mockResolvedValue({
      callTool: vi.fn().mockResolvedValue({content: []}),
      close: vi.fn().mockResolvedValue(undefined),
    }),
    ...overrides,
  };
}

async function openSession(
  options: ReturnType<typeof providerOptions>,
  callerKind?: 'agent' | 'tool_step',
) {
  const provider = new JamAgentToolsProvider(options);
  return await provider.openSession({
    connection: jamConnection(),
    tools: [],
    scope: {provider: 'jam'},
    ...(callerKind === undefined
      ? {}
      : {
          caller: {
            callerKind,
            workspaceId: jamConnection().workspaceId,
            projectId: '00000000-0000-4000-8000-000000000003',
            runId: '00000000-0000-4000-8000-000000000004',
            jobExecutionId: '00000000-0000-4000-8000-000000000005',
            stepId: '00000000-0000-4000-8000-000000000006',
            stepAttempt: 1,
          },
        }),
  });
}

describe('JamAgentToolsProvider', () => {
  it('exposes the catalog and its selection catalog', () => {
    const provider = new JamAgentToolsProvider(providerOptions());

    expect(provider.catalog()).toBe(jamAgentToolCatalog);
    expect(provider.selectionCatalog()).toBe(jamAgentToolSelectionCatalog);
  });

  it('opens a session with the stored token on the configured endpoint', async () => {
    const options = providerOptions({endpoint: 'https://mcp.jam.test/mcp'});

    await openSession(options);

    expect(options.createClient).toHaveBeenCalledWith({
      endpoint: new URL('https://mcp.jam.test/mcp'),
      accessToken: 'jam_pat_secret',
    });
  });

  it('forwards a Jam link and the result unchanged', async () => {
    const result: CallToolResult = {
      content: [
        {type: 'text', text: '{"title":"Checkout"}'},
        {type: 'image', data: 'AAAA', mimeType: 'image/png'},
      ],
    };
    const callTool = vi.fn().mockResolvedValue(result);
    const options = providerOptions({
      createClient: vi.fn().mockResolvedValue({callTool, close: vi.fn()}),
    });
    const session = await openSession(options, 'agent');
    const jamId = 'https://jam.dev/c/4ea19ea4-b021-474f-b254-5df55d37d702';

    const actual = await session.call({toolId: 'getScreenshots', arguments: {jamId}});

    expect(actual).toBe(result);
    expect(callTool).toHaveBeenCalledWith(
      {toolId: 'getScreenshots', arguments: {jamId}},
      expect.any(Number),
    );
  });

  it('adds the query version to searchJams', async () => {
    const callTool = vi.fn().mockResolvedValue({content: []});
    const session = await openSession(
      providerOptions({createClient: vi.fn().mockResolvedValue({callTool, close: vi.fn()})}),
      'tool_step',
    );

    await session.call({toolId: 'searchJams', arguments: {text: 'coupon', v: 7}});

    expect(callTool).toHaveBeenCalledWith(
      {toolId: 'searchJams', arguments: {text: 'coupon', v: 1}},
      expect.any(Number),
    );
  });

  it.each(['getScreenshots', 'getFrames'])('rejects %s for a tool step', async (toolId) => {
    const callTool = vi.fn();
    const session = await openSession(
      providerOptions({createClient: vi.fn().mockResolvedValue({callTool, close: vi.fn()})}),
      'tool_step',
    );

    await expect(session.call({toolId, arguments: {jamId: 'x'}})).rejects.toMatchObject({
      reason: 'provider-rejected',
      message: `${toolId} returns images; call it from an agent step.`,
    });
    expect(callTool).not.toHaveBeenCalled();
  });

  it.each([
    'createComment',
    'deleteJam',
    'deleteFolder',
    'listMembers',
  ])('never forwards %s, which is outside the catalog', async (toolId) => {
    const callTool = vi.fn();
    const session = await openSession(
      providerOptions({createClient: vi.fn().mockResolvedValue({callTool, close: vi.fn()})}),
      'agent',
    );

    await expect(session.call({toolId, arguments: {}})).rejects.toMatchObject({
      reason: 'provider-rejected',
    });
    expect(callTool).not.toHaveBeenCalled();
  });

  it('marks a Jam that does not exist as not-found and passes other errors through', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({
        content: [{type: 'text', text: 'JamNotFound: Could not find jam'}],
        isError: true,
      })
      .mockResolvedValueOnce({
        content: [{type: 'text', text: 'MCP error -32602: Could not resolve Jam ID from: x'}],
        isError: true,
      });
    const session = await openSession(
      providerOptions({createClient: vi.fn().mockResolvedValue({callTool, close: vi.fn()})}),
      'agent',
    );

    const notFound = await session.call({toolId: 'getDetails', arguments: {jamId: 'x'}});
    const invalid = await session.call({toolId: 'getDetails', arguments: {jamId: 'y'}});

    expect(notFound).toMatchObject({isError: true, structuredContent: {code: 'not-found'}});
    expect(invalid).toEqual({
      content: [{type: 'text', text: 'MCP error -32602: Could not resolve Jam ID from: x'}],
      isError: true,
    });
  });

  it('passes a prose answer through as text', async () => {
    const prose = textResult('No custom metadata found for this Jam.');
    const callTool = vi.fn().mockResolvedValue(prose);
    const session = await openSession(
      providerOptions({createClient: vi.fn().mockResolvedValue({callTool, close: vi.fn()})}),
      'tool_step',
    );

    expect(await session.call({toolId: 'getMetadata', arguments: {jamId: 'x'}})).toBe(prose);
  });

  it('marks the connection as errored under the credential version when initialize returns 401', async () => {
    const options = providerOptions({
      createClient: vi.fn().mockRejectedValue(new StreamableHTTPError(401, 'invalid_token')),
    });

    await expect(openSession(options)).rejects.toMatchObject({
      reason: 'credentials-unavailable',
      status: 401,
    });

    expect(options.markConnectionError).toHaveBeenCalledWith({
      connectionId: jamConnection().id,
      credentialVersion: jamInstallation().credentialVersion,
    });
  });

  it.each([
    [403, 'provider-rejected'],
    [404, 'provider-rejected'],
    [429, 'rate-limited'],
    [408, 'timeout'],
    [503, 'provider-unavailable'],
  ])('maps HTTP %s at initialize to %s without marking the connection', async (status, reason) => {
    const options = providerOptions({
      createClient: vi.fn().mockRejectedValue(new StreamableHTTPError(status, 'x')),
    });

    await expect(openSession(options)).rejects.toMatchObject({reason});

    expect(options.markConnectionError).not.toHaveBeenCalled();
  });

  it('marks the connection as errored when a call is rejected with HTTP 401', async () => {
    const callTool = vi.fn().mockRejectedValue(new StreamableHTTPError(401, 'invalid_token'));
    const options = providerOptions({
      createClient: vi.fn().mockResolvedValue({callTool, close: vi.fn()}),
    });
    const session = await openSession(options, 'agent');

    await expect(
      session.call({toolId: 'getDetails', arguments: {jamId: 'x'}}),
    ).rejects.toMatchObject({reason: 'credentials-unavailable', status: 401});

    expect(options.markConnectionError).toHaveBeenCalledWith({
      connectionId: jamConnection().id,
      credentialVersion: jamInstallation().credentialVersion,
    });
  });

  it('maps MCP and network failures during a call', async () => {
    const callTool = vi
      .fn()
      .mockRejectedValueOnce(new McpError(ErrorCode.RequestTimeout, 'timed out'))
      .mockRejectedValueOnce(new McpError(ErrorCode.InvalidParams, 'bad'))
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    const session = await openSession(
      providerOptions({createClient: vi.fn().mockResolvedValue({callTool, close: vi.fn()})}),
      'agent',
    );
    const call = () => session.call({toolId: 'getDetails', arguments: {jamId: 'x'}});

    await expect(call()).rejects.toMatchObject({reason: 'timeout'});
    await expect(call()).rejects.toMatchObject({reason: 'provider-rejected'});
    await expect(call()).rejects.toBeInstanceOf(JamIntegrationProviderError);
  });

  it('fails when the connection has no token', async () => {
    const options = providerOptions({
      credentialStore: {getToken: vi.fn().mockResolvedValue(null)},
    });

    await expect(openSession(options)).rejects.toThrow('Jam token is missing');
    expect(options.createClient).not.toHaveBeenCalled();
  });

  it('closes the client with the session', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const session = await openSession(
      providerOptions({createClient: vi.fn().mockResolvedValue({callTool: vi.fn(), close})}),
    );

    await session.close?.();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
