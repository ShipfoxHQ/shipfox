import {JAM_TEAM_ID, JAM_USER_ID, jamConnection} from '#test/fixtures/jam.js';
import {handleJamConnect} from './connect.js';
import {createJamCredentialStore} from './credentials.js';
import {JamInvalidTokenError} from './errors.js';

const validated = {
  teamId: JAM_TEAM_ID,
  userId: JAM_USER_ID,
  userName: 'Ada',
  userEmail: 'ada@example.com',
};

function credentials(options: {failCreate?: boolean} = {}) {
  const values = new Map<string, string>();
  const store = createJamCredentialStore({
    resolveConnection: async () => ({workspaceId: 'workspace-1'}),
    secrets: {
      getSecret: async ({namespace}) => values.get(namespace) ?? null,
      setSecrets: ({namespace, values: nextValues}) => {
        if (options.failCreate) throw new Error('secret write failed');
        values.set(namespace, nextValues.ACCESS_TOKEN ?? '');
        return Promise.resolve();
      },
      deleteSecrets: async ({namespace}) => Number(values.delete(namespace)),
    },
  });
  return {store, values};
}

describe('handleJamConnect', () => {
  it('validates the token, stores it and creates the connection', async () => {
    const secretState = credentials();
    const validateToken = vi.fn(async () => validated);
    const createConnection = vi.fn(async () => jamConnection());
    const getExistingConnection = vi.fn(async () => undefined);

    const result = await handleJamConnect({
      workspaceId: jamConnection().workspaceId,
      token: 'jam_pat_secret',
      validateToken,
      credentials: secretState.store,
      getExistingConnection,
      createConnection,
    });

    expect(result).toMatchObject({status: 'connected', connection: {id: jamConnection().id}});
    expect(validateToken).toHaveBeenCalledWith('jam_pat_secret');
    expect(getExistingConnection).toHaveBeenCalledWith({
      workspaceId: jamConnection().workspaceId,
      externalAccountId: JAM_TEAM_ID,
    });
    expect(createConnection).toHaveBeenCalledWith({
      ...validated,
      id: expect.any(String),
      workspaceId: jamConnection().workspaceId,
      token: 'jam_pat_secret',
    });
    expect([...secretState.values.values()]).toEqual(['jam_pat_secret']);
  });

  it('writes nothing when validation fails', async () => {
    const secretState = credentials();
    const createConnection = vi.fn();

    await expect(
      handleJamConnect({
        workspaceId: jamConnection().workspaceId,
        token: 'jam_pat_revoked',
        validateToken: vi.fn(() => Promise.reject(new JamInvalidTokenError())),
        credentials: secretState.store,
        getExistingConnection: vi.fn(),
        createConnection,
      }),
    ).rejects.toBeInstanceOf(JamInvalidTokenError);

    expect(secretState.values.size).toBe(0);
    expect(createConnection).not.toHaveBeenCalled();
  });

  it('reports an existing connection for the Jam workspace without writing a secret', async () => {
    const secretState = credentials();
    const createConnection = vi.fn();

    const result = await handleJamConnect({
      workspaceId: jamConnection().workspaceId,
      token: 'jam_pat_secret',
      validateToken: vi.fn(async () => validated),
      credentials: secretState.store,
      getExistingConnection: vi.fn(async () => jamConnection()),
      createConnection,
    });

    expect(result).toEqual({status: 'already-connected', connectionId: jamConnection().id});
    expect(secretState.values.size).toBe(0);
    expect(createConnection).not.toHaveBeenCalled();
  });

  it('deletes the secret when the connection cannot be created', async () => {
    const secretState = credentials();
    const failure = new Error('database unavailable');

    await expect(
      handleJamConnect({
        workspaceId: jamConnection().workspaceId,
        token: 'jam_pat_secret',
        validateToken: vi.fn(async () => validated),
        credentials: secretState.store,
        getExistingConnection: vi.fn(async () => undefined),
        createConnection: vi.fn(() => Promise.reject(failure)),
      }),
    ).rejects.toBe(failure);

    expect(secretState.values.size).toBe(0);
  });

  it('reports the winner when a concurrent connect creates the connection first', async () => {
    const secretState = credentials();
    const getExistingConnection = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(jamConnection());

    const result = await handleJamConnect({
      workspaceId: jamConnection().workspaceId,
      token: 'jam_pat_secret',
      validateToken: vi.fn(async () => validated),
      credentials: secretState.store,
      getExistingConnection,
      createConnection: vi.fn(() => Promise.reject(new Error('unique violation'))),
    });

    expect(result).toEqual({status: 'already-connected', connectionId: jamConnection().id});
    expect(secretState.values.size).toBe(0);
  });

  it('does not create a connection when the secret cannot be stored', async () => {
    const secretState = credentials({failCreate: true});
    const createConnection = vi.fn();

    await expect(
      handleJamConnect({
        workspaceId: jamConnection().workspaceId,
        token: 'jam_pat_secret',
        validateToken: vi.fn(async () => validated),
        credentials: secretState.store,
        getExistingConnection: vi.fn(async () => undefined),
        createConnection,
      }),
    ).rejects.toThrow('secret write failed');

    expect(createConnection).not.toHaveBeenCalled();
  });
});
