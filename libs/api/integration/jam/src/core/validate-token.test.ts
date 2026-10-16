import {StreamableHTTPError} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  activeIntrospection,
  clientFactory,
  introspectionClient,
  JAM_TEAM_ID,
  JAM_USER_ID,
  mcpClient,
  membersResult,
  textResult,
} from '#test/fixtures/jam.js';
import {
  JamIntegrationProviderError,
  JamInvalidTokenError,
  JamMcpUnavailableError,
  JamMissingReadScopeError,
  JamTokenPrefixError,
} from './errors.js';
import {validateJamToken} from './validate-token.js';

const endpoint = new URL('https://mcp.jam.test/mcp');
const members = [
  {id: 'other-user', name: 'Grace', email: 'grace@example.com', role: 'Member'},
  {id: JAM_USER_ID, name: 'Ada', email: 'ada@example.com', role: 'Admin'},
];

describe('validateJamToken', () => {
  it('returns the workspace from introspection and the user from listMembers', async () => {
    const client = mcpClient(() => membersResult(members));
    const createClient = clientFactory(client);

    const result = await validateJamToken({
      token: 'jam_pat_secret',
      endpoint,
      introspection: introspectionClient(activeIntrospection()),
      createClient,
    });

    expect(result).toEqual({
      teamId: JAM_TEAM_ID,
      userId: JAM_USER_ID,
      userName: 'Ada',
      userEmail: 'ada@example.com',
    });
    expect(createClient).toHaveBeenCalledWith({endpoint, accessToken: 'jam_pat_secret'});
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it('rejects a token without the Jam prefix before any request', async () => {
    const introspection = introspectionClient(activeIntrospection());

    await expect(
      validateJamToken({
        token: 'phx_secret',
        endpoint,
        introspection,
        createClient: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(JamTokenPrefixError);

    expect(introspection.introspect).not.toHaveBeenCalled();
  });

  it('rejects an inactive token', async () => {
    const createClient = vi.fn();

    await expect(
      validateJamToken({
        token: 'jam_pat_revoked',
        endpoint,
        introspection: introspectionClient({active: false}),
        createClient,
      }),
    ).rejects.toBeInstanceOf(JamInvalidTokenError);

    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects a CLI-only token that has no MCP read scope', async () => {
    const createClient = vi.fn();

    await expect(
      validateJamToken({
        token: 'jam_pat_cli',
        endpoint,
        introspection: introspectionClient(
          activeIntrospection({scopes: ['cli:read', 'cli:write']}),
        ),
        createClient,
      }),
    ).rejects.toBeInstanceOf(JamMissingReadScopeError);

    expect(createClient).not.toHaveBeenCalled();
  });

  it('reports a rejected initialize as an invalid token', async () => {
    await expect(
      validateJamToken({
        token: 'jam_pat_secret',
        endpoint,
        introspection: introspectionClient(activeIntrospection()),
        createClient: vi.fn(() => Promise.reject(new StreamableHTTPError(401, 'invalid_token'))),
      }),
    ).rejects.toBeInstanceOf(JamInvalidTokenError);
  });

  it('reports a forbidden initialize as an unavailable MCP', async () => {
    await expect(
      validateJamToken({
        token: 'jam_pat_secret',
        endpoint,
        introspection: introspectionClient(activeIntrospection()),
        createClient: vi.fn(() => Promise.reject(new StreamableHTTPError(403, 'forbidden'))),
      }),
    ).rejects.toBeInstanceOf(JamMcpUnavailableError);
  });

  it('keeps a Jam outage retryable instead of calling the token invalid', async () => {
    await expect(
      validateJamToken({
        token: 'jam_pat_secret',
        endpoint,
        introspection: introspectionClient(activeIntrospection()),
        createClient: vi.fn(() => Promise.reject(new StreamableHTTPError(503, 'down'))),
      }),
    ).rejects.toMatchObject({reason: 'provider-unavailable'});
  });

  it('reports an error result from listMembers with Jam message', async () => {
    const client = mcpClient(() => ({
      content: [{type: 'text', text: 'MCP error -32600: Insufficient scope'}],
      isError: true,
    }));

    await expect(
      validateJamToken({
        token: 'jam_pat_secret',
        endpoint,
        introspection: introspectionClient(activeIntrospection()),
        createClient: clientFactory(client),
      }),
    ).rejects.toThrow('Insufficient scope');
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it('reports an unreadable member list as an unavailable MCP', async () => {
    const client = mcpClient(() => textResult('not json'));

    await expect(
      validateJamToken({
        token: 'jam_pat_secret',
        endpoint,
        introspection: introspectionClient(activeIntrospection()),
        createClient: clientFactory(client),
      }),
    ).rejects.toBeInstanceOf(JamMcpUnavailableError);
  });

  it('reports a user that is not in the member list', async () => {
    const client = mcpClient(() => membersResult([members[0] as (typeof members)[number]]));

    await expect(
      validateJamToken({
        token: 'jam_pat_secret',
        endpoint,
        introspection: introspectionClient(activeIntrospection()),
        createClient: clientFactory(client),
      }),
    ).rejects.toBeInstanceOf(JamMcpUnavailableError);
    expect(client.callTool).toHaveBeenCalledTimes(2);
  });

  it('pages through listMembers with the last user id until it finds the user', async () => {
    const firstPage = Array.from({length: 250}, (_, index) => ({
      id: `user-${index}`,
      name: `User ${index}`,
    }));
    const client = mcpClient(({arguments: args}) =>
      args.after === 'user-249'
        ? membersResult([members[1] as (typeof members)[number]])
        : membersResult(firstPage),
    );

    const result = await validateJamToken({
      token: 'jam_pat_secret',
      endpoint,
      introspection: introspectionClient(activeIntrospection()),
      createClient: clientFactory(client),
    });

    expect(result.userName).toBe('Ada');
    expect(client.callTool).toHaveBeenNthCalledWith(
      1,
      {toolId: 'listMembers', arguments: {limit: 250}},
      expect.any(Number),
    );
    expect(client.callTool).toHaveBeenNthCalledWith(
      2,
      {toolId: 'listMembers', arguments: {limit: 250, after: 'user-249'}},
      expect.any(Number),
    );
  });

  it('keeps paging when Jam returns pages smaller than the limit', async () => {
    const pages: Record<string, Array<{id: string; name: string}>> = {
      first: [{id: 'user-1', name: 'One'}],
      'user-1': [{id: 'user-2', name: 'Two'}],
      'user-2': [{id: JAM_USER_ID, name: 'Ada'}],
    };
    const client = mcpClient(({arguments: args}) =>
      membersResult(pages[(args.after as string | undefined) ?? 'first'] ?? []),
    );

    const result = await validateJamToken({
      token: 'jam_pat_secret',
      endpoint,
      introspection: introspectionClient(activeIntrospection()),
      createClient: clientFactory(client),
    });

    expect(result.userName).toBe('Ada');
    expect(client.callTool).toHaveBeenCalledTimes(3);
  });

  it('stops paging when a page repeats members it already returned', async () => {
    const client = mcpClient(() => membersResult([{id: 'user-1', name: 'One'}]));

    await expect(
      validateJamToken({
        token: 'jam_pat_secret',
        endpoint,
        introspection: introspectionClient(activeIntrospection()),
        createClient: clientFactory(client),
      }),
    ).rejects.toBeInstanceOf(JamMcpUnavailableError);
    expect(client.callTool).toHaveBeenCalledTimes(2);
  });

  it('stores no email when Jam reports none', async () => {
    const client = mcpClient(() => membersResult([{id: JAM_USER_ID, name: 'Ada'}]));

    const result = await validateJamToken({
      token: 'jam_pat_secret',
      endpoint,
      introspection: introspectionClient(activeIntrospection()),
      createClient: clientFactory(client),
    });

    expect(result.userEmail).toBeNull();
  });

  it('passes an introspection failure through', async () => {
    const failure = new JamIntegrationProviderError('provider-unavailable', 'down');

    await expect(
      validateJamToken({
        token: 'jam_pat_secret',
        endpoint,
        introspection: {introspect: vi.fn(() => Promise.reject(failure))},
        createClient: vi.fn(),
      }),
    ).rejects.toBe(failure);
  });
});
