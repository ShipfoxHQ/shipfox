import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {JamInstallation} from '#db/installations.js';
import {
  activeIntrospection,
  clientFactory,
  introspectionClient,
  JAM_TEAM_ID,
  jamConnection,
  jamCredentials,
  jamInstallation,
  mcpClient,
  membersResult,
} from '#test/fixtures/jam.js';
import {
  JamCredentialVersionMismatchError,
  JamInvalidTokenError,
  JamWorkspaceMismatchError,
} from './errors.js';
import {handleJamReplaceToken} from './replace-token.js';
import {createJamTokenValidator} from './validate-token.js';

const connection = jamConnection({lifecycleStatus: 'error'});
const installation = jamInstallation();
const validated = {
  teamId: JAM_TEAM_ID,
  userId: 'user-2',
  userName: 'Grace',
  userEmail: 'grace@example.com',
};

function guard(installationForCallback: JamInstallation = installation) {
  return vi.fn(
    async (params: {
      callback: (input: {
        tx: unknown;
        installation: JamInstallation;
      }) => Promise<IntegrationConnection<'jam'> | undefined>;
    }) => ({
      matched: true as const,
      value: await params.callback({tx: {}, installation: installationForCallback}),
    }),
  );
}

describe('handleJamReplaceToken', () => {
  it('validates before replacing and activates the same connection', async () => {
    const credentials = jamCredentials();
    const validateToken = vi.fn(async () => validated);
    const updateInstallationCredential = vi.fn(() => Promise.resolve(installation));
    const updateConnection = vi.fn(() =>
      Promise.resolve({...connection, lifecycleStatus: 'active' as const}),
    );

    const result = await handleJamReplaceToken({
      connection,
      token: 'jam_pat_new',
      validateToken,
      credentials,
      getInstallation: async () => installation,
      updateConnection,
      withCredentialVersion: guard() as never,
      updateInstallationCredential,
    });

    expect(result).toMatchObject({id: connection.id, slug: 'jam', lifecycleStatus: 'active'});
    expect(validateToken).toHaveBeenCalledWith('jam_pat_new');
    expect(credentials.setToken).toHaveBeenCalledWith({
      connectionId: connection.id,
      workspaceId: connection.workspaceId,
      token: 'jam_pat_new',
    });
    expect(updateInstallationCredential).toHaveBeenCalledWith({
      connectionId: connection.id,
      token: 'jam_pat_new',
      userId: 'user-2',
      userName: 'Grace',
      userEmail: 'grace@example.com',
      credentialVersion: 4,
      tx: {},
    });
  });

  it('keeps the old token and status when the new token cannot reach the MCP', async () => {
    const credentials = jamCredentials();
    const updateConnection = vi.fn();
    const withCredentialVersion = vi.fn();
    // The real validator, with an MCP that refuses the new token at initialize.
    const validateToken = createJamTokenValidator({
      introspection: introspectionClient(activeIntrospection()),
      endpoint: 'https://mcp.jam.test/mcp',
      createClient: vi.fn(() => Promise.reject(Object.assign(new Error('401'), {code: 401}))),
    });

    await expect(
      handleJamReplaceToken({
        connection,
        token: 'jam_pat_new',
        validateToken,
        credentials,
        getInstallation: async () => installation,
        updateConnection,
        withCredentialVersion: withCredentialVersion as never,
      }),
    ).rejects.toThrow();

    expect(credentials.setToken).not.toHaveBeenCalled();
    expect(credentials.deleteToken).not.toHaveBeenCalled();
    expect(withCredentialVersion).not.toHaveBeenCalled();
    expect(updateConnection).not.toHaveBeenCalled();
  });

  it('keeps the old token and status when listMembers cannot read the user', async () => {
    const credentials = jamCredentials();
    const updateConnection = vi.fn();
    const validateToken = createJamTokenValidator({
      introspection: introspectionClient(activeIntrospection()),
      endpoint: 'https://mcp.jam.test/mcp',
      createClient: clientFactory(
        mcpClient(() => ({
          content: [{type: 'text', text: 'MCP error -32600: Insufficient scope'}],
          isError: true,
        })),
      ),
    });

    await expect(
      handleJamReplaceToken({
        connection,
        token: 'jam_pat_new',
        validateToken,
        credentials,
        getInstallation: async () => installation,
        updateConnection,
      }),
    ).rejects.toThrow('Insufficient scope');

    expect(credentials.setToken).not.toHaveBeenCalled();
    expect(updateConnection).not.toHaveBeenCalled();
  });

  it('accepts a token from another user of the same Jam workspace', async () => {
    const validateToken = createJamTokenValidator({
      introspection: introspectionClient(activeIntrospection({userId: 'user-2'})),
      endpoint: 'https://mcp.jam.test/mcp',
      createClient: clientFactory(
        mcpClient(() => membersResult([{id: 'user-2', name: 'Grace', email: 'grace@example.com'}])),
      ),
    });
    const updateInstallationCredential = vi.fn(() => Promise.resolve(installation));

    await handleJamReplaceToken({
      connection,
      token: 'jam_pat_new',
      validateToken,
      credentials: jamCredentials(),
      getInstallation: async () => installation,
      updateConnection: vi.fn(() => Promise.resolve(connection)),
      withCredentialVersion: guard() as never,
      updateInstallationCredential,
    });

    expect(updateInstallationCredential).toHaveBeenCalledWith(
      expect.objectContaining({userId: 'user-2', userName: 'Grace'}),
    );
  });

  it('rejects a token from another Jam workspace without writing', async () => {
    const credentials = jamCredentials();

    await expect(
      handleJamReplaceToken({
        connection,
        token: 'jam_pat_other',
        validateToken: vi.fn(async () => ({...validated, teamId: 'another-team'})),
        credentials,
        getInstallation: async () => installation,
        updateConnection: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(JamWorkspaceMismatchError);

    expect(credentials.setToken).not.toHaveBeenCalled();
  });

  it('passes a validation failure through without writing', async () => {
    const credentials = jamCredentials();
    const updateConnection = vi.fn();
    const failure = new JamInvalidTokenError();

    await expect(
      handleJamReplaceToken({
        connection,
        token: 'jam_pat_revoked',
        validateToken: vi.fn(() => Promise.reject(failure)),
        credentials,
        getInstallation: async () => installation,
        updateConnection,
      }),
    ).rejects.toBe(failure);

    expect(credentials.setToken).not.toHaveBeenCalled();
    expect(credentials.deleteToken).not.toHaveBeenCalled();
    expect(updateConnection).not.toHaveBeenCalled();
  });

  it('does not write the secret when the credential version is stale', async () => {
    const credentials = jamCredentials();
    const withCredentialVersion = vi.fn(() =>
      Promise.resolve({matched: false as const, reason: 'version-mismatch' as const}),
    );

    await expect(
      handleJamReplaceToken({
        connection,
        token: 'jam_pat_new',
        validateToken: vi.fn(async () => validated),
        credentials,
        getInstallation: async () => installation,
        updateConnection: vi.fn(),
        withCredentialVersion,
      }),
    ).rejects.toBeInstanceOf(JamCredentialVersionMismatchError);

    expect(credentials.setToken).not.toHaveBeenCalled();
  });

  it('restores the previous secret when the metadata transaction fails', async () => {
    const credentials = jamCredentials();
    const transactionError = new Error('transaction failed');
    const withCredentialVersion = guard();

    await expect(
      handleJamReplaceToken({
        connection,
        token: 'jam_pat_new',
        validateToken: vi.fn(async () => validated),
        credentials,
        getInstallation: async () => installation,
        updateConnection: vi.fn(() => Promise.reject(transactionError)),
        withCredentialVersion: withCredentialVersion as never,
        updateInstallationCredential: vi.fn(() => Promise.resolve(installation)),
      }),
    ).rejects.toBe(transactionError);

    expect(credentials.setToken).toHaveBeenNthCalledWith(1, {
      connectionId: connection.id,
      workspaceId: connection.workspaceId,
      token: 'jam_pat_new',
    });
    expect(credentials.setToken).toHaveBeenNthCalledWith(2, {
      connectionId: connection.id,
      workspaceId: connection.workspaceId,
      token: 'jam_pat_old',
    });
    expect(withCredentialVersion).toHaveBeenCalledTimes(2);
  });

  it('does not restore over a newer successful replacement', async () => {
    const credentials = jamCredentials();
    const transactionError = new Error('transaction failed');
    const withCredentialVersion = vi
      .fn()
      .mockImplementationOnce(
        async (params: {
          callback: (input: {tx: unknown; installation: JamInstallation}) => Promise<unknown>;
        }) => ({
          matched: true as const,
          value: await params.callback({tx: {}, installation}),
        }),
      )
      .mockResolvedValueOnce({matched: false as const, reason: 'version-mismatch' as const});

    await expect(
      handleJamReplaceToken({
        connection,
        token: 'jam_pat_new',
        validateToken: vi.fn(async () => validated),
        credentials,
        getInstallation: async () => installation,
        updateConnection: vi.fn(() => Promise.reject(transactionError)),
        withCredentialVersion: withCredentialVersion as never,
        updateInstallationCredential: vi.fn(() => Promise.resolve(installation)),
      }),
    ).rejects.toBe(transactionError);

    expect(credentials.setToken).toHaveBeenCalledTimes(1);
  });
});
