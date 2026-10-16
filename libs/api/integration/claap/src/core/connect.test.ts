import {randomUUID} from 'node:crypto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {
  createClaapInstallation,
  deleteClaapInstallationByConnectionId,
  getClaapInstallationByConnectionId,
} from '#db/installations.js';
import {handleClaapConnect} from './connect.js';
import {createClaapCredentialStore} from './credentials.js';
import {
  ClaapAlreadyConnectedError,
  ClaapApiKeyPrefixError,
  ClaapInvalidApiKeyError,
  ClaapUnexpectedWorkspaceCountError,
} from './errors.js';

const claapWorkspace = {workspaceId: 'q2IqD9wUHb', name: 'Mercateam'};

function connection(id: string = randomUUID()): IntegrationConnection<'claap'> {
  return {
    id,
    workspaceId: '00000000-0000-4000-8000-000000000002',
    provider: 'claap',
    externalAccountId: claapWorkspace.workspaceId,
    slug: 'claap_mercateam',
    displayName: 'Claap Mercateam',
    lifecycleStatus: 'active',
    repositoryAccessMode: 'selected',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function credentials() {
  const values = new Map<string, string>();
  const store = createClaapCredentialStore({
    resolveConnection: async () => ({workspaceId: 'workspace-1'}),
    secrets: {
      getSecret: async ({namespace}) => values.get(namespace) ?? null,
      setSecrets: ({namespace, values: nextValues}) => {
        values.set(namespace, nextValues.API_KEY ?? '');
        return Promise.resolve();
      },
      deleteSecrets: async ({namespace}) => Number(values.delete(namespace)),
    },
  });
  return {store, values};
}

const createdConnectionIds: string[] = [];

describe('handleClaapConnect', () => {
  afterEach(async () => {
    for (const connectionId of createdConnectionIds) {
      await deleteClaapInstallationByConnectionId(connectionId);
    }
    createdConnectionIds.length = 0;
  });

  it('connects the one workspace of the key and stores the installation in Postgres', async () => {
    const secretState = credentials();
    const getExistingConnection = vi.fn(async () => undefined);

    const result = await handleClaapConnect({
      workspaceId: 'workspace-1',
      apiKey: 'cla_secret_1234',
      listClaapWorkspaces: vi.fn(async () => [claapWorkspace]),
      credentials: secretState.store,
      getExistingConnection,
      createConnection: async (input) => {
        await createClaapInstallation({
          connectionId: input.id,
          workspaceId: input.claapWorkspaceId,
          workspaceName: input.claapWorkspaceName,
          keyHint: input.apiKey,
        });
        createdConnectionIds.push(input.id);
        return connection(input.id);
      },
    });

    expect(getExistingConnection).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      externalAccountId: 'q2IqD9wUHb',
    });
    expect([...secretState.values.values()]).toEqual(['cla_secret_1234']);
    expect(await getClaapInstallationByConnectionId(result.id)).toMatchObject({
      workspaceId: 'q2IqD9wUHb',
      workspaceName: 'Mercateam',
      keyHint: '1234',
      credentialVersion: 1,
    });
  });

  it('rejects a key without the cla_ prefix before calling Claap', async () => {
    const listClaapWorkspaces = vi.fn();

    await expect(
      handleClaapConnect({
        workspaceId: 'workspace-1',
        apiKey: 'sk_secret',
        listClaapWorkspaces,
        credentials: credentials().store,
        getExistingConnection: vi.fn(),
        createConnection: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(ClaapApiKeyPrefixError);
    expect(listClaapWorkspaces).not.toHaveBeenCalled();
  });

  it('writes no secret when Claap does not accept the key', async () => {
    const secretState = credentials();

    await expect(
      handleClaapConnect({
        workspaceId: 'workspace-1',
        apiKey: 'cla_revoked',
        listClaapWorkspaces: vi.fn(() => Promise.reject(new ClaapInvalidApiKeyError())),
        credentials: secretState.store,
        getExistingConnection: vi.fn(),
        createConnection: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(ClaapInvalidApiKeyError);
    expect(secretState.values.size).toBe(0);
  });

  it.each([
    [[]],
    [[claapWorkspace, {workspaceId: 'other', name: 'Other'}]],
  ])('rejects a key that does not belong to exactly one workspace', async (workspaces) => {
    const secretState = credentials();
    const createConnection = vi.fn();

    await expect(
      handleClaapConnect({
        workspaceId: 'workspace-1',
        apiKey: 'cla_secret',
        listClaapWorkspaces: async () => workspaces,
        credentials: secretState.store,
        getExistingConnection: vi.fn(),
        createConnection,
      }),
    ).rejects.toBeInstanceOf(ClaapUnexpectedWorkspaceCountError);
    expect(secretState.values.size).toBe(0);
    expect(createConnection).not.toHaveBeenCalled();
  });

  it('reports the existing connection without writing a secret', async () => {
    const secretState = credentials();
    const existing = connection();

    await expect(
      handleClaapConnect({
        workspaceId: existing.workspaceId,
        apiKey: 'cla_secret',
        listClaapWorkspaces: async () => [claapWorkspace],
        credentials: secretState.store,
        getExistingConnection: async () => existing,
        createConnection: vi.fn(),
      }),
    ).rejects.toMatchObject({
      name: ClaapAlreadyConnectedError.name,
      connectionId: existing.id,
    });
    expect(secretState.values.size).toBe(0);
  });

  it('removes the secret when connection creation fails', async () => {
    const secretState = credentials();
    const error = new Error('transaction failed');

    await expect(
      handleClaapConnect({
        workspaceId: 'workspace-1',
        apiKey: 'cla_secret',
        listClaapWorkspaces: async () => [claapWorkspace],
        credentials: secretState.store,
        getExistingConnection: async () => undefined,
        createConnection: vi.fn(() => Promise.reject(error)),
      }),
    ).rejects.toBe(error);
    expect(secretState.values.size).toBe(0);
  });

  it('reports the concurrent connection when creation loses the uniqueness race', async () => {
    const secretState = credentials();
    const existing = connection();
    const getExistingConnection = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(existing);

    await expect(
      handleClaapConnect({
        workspaceId: existing.workspaceId,
        apiKey: 'cla_secret',
        listClaapWorkspaces: async () => [claapWorkspace],
        credentials: secretState.store,
        getExistingConnection,
        createConnection: vi.fn(() => Promise.reject(new Error('connection already exists'))),
      }),
    ).rejects.toMatchObject({name: ClaapAlreadyConnectedError.name, connectionId: existing.id});
    expect(secretState.values.size).toBe(0);
    expect(getExistingConnection).toHaveBeenCalledTimes(2);
  });
});
