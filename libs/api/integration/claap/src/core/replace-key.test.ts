import {randomUUID} from 'node:crypto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {
  type ClaapInstallation,
  createClaapInstallation,
  deleteClaapInstallationByConnectionId,
  getClaapInstallationByConnectionId,
  withClaapCredentialVersion,
} from '#db/installations.js';
import type {ClaapCredentialStore} from './credentials.js';
import {
  ClaapApiKeyPrefixError,
  ClaapCredentialVersionMismatchError,
  ClaapInvalidApiKeyError,
  ClaapUnexpectedWorkspaceCountError,
  ClaapWorkspaceMismatchError,
} from './errors.js';
import {handleClaapReplaceApiKey} from './replace-key.js';

const claapWorkspace = {workspaceId: 'q2IqD9wUHb', name: 'Mercateam'};

function connection(id: string): IntegrationConnection<'claap'> {
  return {
    id,
    workspaceId: '00000000-0000-4000-8000-000000000002',
    provider: 'claap',
    externalAccountId: claapWorkspace.workspaceId,
    slug: 'claap_mercateam',
    displayName: 'Claap Mercateam',
    lifecycleStatus: 'error',
    repositoryAccessMode: 'selected',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-02T00:00:00.000Z'),
  };
}

function credentials(): ClaapCredentialStore {
  return {
    getApiKey: vi.fn(() => Promise.resolve('cla_old')),
    setApiKey: vi.fn(() => Promise.resolve()),
    deleteApiKey: vi.fn(() => Promise.resolve(1)),
  };
}

let connectionId: string;
let current: IntegrationConnection<'claap'>;
let installation: ClaapInstallation;

function replace(overrides: Partial<Parameters<typeof handleClaapReplaceApiKey>[0]> = {}) {
  return handleClaapReplaceApiKey({
    connectionId,
    apiKey: 'cla_new_key',
    listClaapWorkspaces: async () => [claapWorkspace],
    credentials: credentials(),
    getConnection: async () => current,
    updateConnection: async () => ({...current, lifecycleStatus: 'active'}),
    ...overrides,
  });
}

describe('handleClaapReplaceApiKey', () => {
  beforeEach(async () => {
    connectionId = randomUUID();
    current = connection(connectionId);
    installation = await createClaapInstallation({
      connectionId,
      workspaceId: claapWorkspace.workspaceId,
      workspaceName: claapWorkspace.name,
      keyHint: 'old1',
    });
  });

  afterEach(async () => {
    await deleteClaapInstallationByConnectionId(connectionId);
  });

  it('replaces the key of the same workspace, bumps the version, and activates the connection', async () => {
    const credentialStore = credentials();
    const updateConnection = vi.fn(async () => ({...current, lifecycleStatus: 'active' as const}));

    const result = await replace({credentials: credentialStore, updateConnection});

    expect(result).toMatchObject({
      id: connectionId,
      slug: 'claap_mercateam',
      lifecycleStatus: 'active',
    });
    expect(credentialStore.setApiKey).toHaveBeenCalledWith({
      connectionId,
      workspaceId: current.workspaceId,
      apiKey: 'cla_new_key',
    });
    expect(await getClaapInstallationByConnectionId(connectionId)).toMatchObject({
      keyHint: '_key',
      credentialVersion: installation.credentialVersion + 1,
    });
    expect(updateConnection).toHaveBeenCalledWith(
      expect.objectContaining({id: connectionId, lifecycleStatus: 'active'}),
    );
  });

  it.each([
    'active',
    'disabled',
  ] as const)('keeps a %s connection as it is after replacing the key', async (lifecycleStatus) => {
    current = {...current, lifecycleStatus};
    const updateConnection = vi.fn();

    const result = await replace({updateConnection});

    expect(result.lifecycleStatus).toBe(lifecycleStatus);
    expect(updateConnection).not.toHaveBeenCalled();
    expect(await getClaapInstallationByConnectionId(connectionId)).toMatchObject({
      credentialVersion: installation.credentialVersion + 1,
    });
  });

  it('reads the key to restore while holding the installation lock', async () => {
    let locked = false;
    const lockedWhenRead: boolean[] = [];
    const credentialStore = credentials();
    vi.mocked(credentialStore.getApiKey).mockImplementation(() => {
      lockedWhenRead.push(locked);
      return Promise.resolve('cla_old');
    });

    await replace({
      credentials: credentialStore,
      withCredentialVersion: async (guard) => {
        locked = true;
        try {
          return await withClaapCredentialVersion(guard);
        } finally {
          locked = false;
        }
      },
    });

    expect(lockedWhenRead).toEqual([true]);
  });

  it('refuses a key for another workspace and keeps the previous key', async () => {
    const credentialStore = credentials();
    const updateConnection = vi.fn();

    await expect(
      replace({
        credentials: credentialStore,
        updateConnection,
        listClaapWorkspaces: async () => [{workspaceId: 'otherWorkspace', name: 'Other'}],
      }),
    ).rejects.toBeInstanceOf(ClaapWorkspaceMismatchError);

    expect(credentialStore.setApiKey).not.toHaveBeenCalled();
    expect(updateConnection).not.toHaveBeenCalled();
    expect(await getClaapInstallationByConnectionId(connectionId)).toMatchObject({
      keyHint: 'old1',
      credentialVersion: 1,
    });
  });

  it('refuses a key that belongs to several workspaces', async () => {
    await expect(
      replace({
        listClaapWorkspaces: async () => [claapWorkspace, {workspaceId: 'other', name: 'Other'}],
      }),
    ).rejects.toBeInstanceOf(ClaapUnexpectedWorkspaceCountError);
  });

  it('refuses a key without the cla_ prefix before calling Claap', async () => {
    const listClaapWorkspaces = vi.fn();

    await expect(replace({apiKey: 'phx_wrong', listClaapWorkspaces})).rejects.toBeInstanceOf(
      ClaapApiKeyPrefixError,
    );
    expect(listClaapWorkspaces).not.toHaveBeenCalled();
  });

  it('keeps the previous key when Claap does not accept the new one', async () => {
    const credentialStore = credentials();

    await expect(
      replace({
        credentials: credentialStore,
        listClaapWorkspaces: () => Promise.reject(new ClaapInvalidApiKeyError()),
      }),
    ).rejects.toBeInstanceOf(ClaapInvalidApiKeyError);
    expect(credentialStore.setApiKey).not.toHaveBeenCalled();
    expect(credentialStore.deleteApiKey).not.toHaveBeenCalled();
  });

  it('does not write the secret when the credential version moved on after validation', async () => {
    const credentialStore = credentials();
    const updateConnection = vi.fn();

    await expect(
      replace({
        credentials: credentialStore,
        updateConnection,
        // A concurrent replacement lands while this one validates the new key.
        listClaapWorkspaces: async () => {
          await replace();
          return [claapWorkspace];
        },
      }),
    ).rejects.toBeInstanceOf(ClaapCredentialVersionMismatchError);

    expect(credentialStore.setApiKey).not.toHaveBeenCalled();
    expect(updateConnection).not.toHaveBeenCalled();
    expect(await getClaapInstallationByConnectionId(connectionId)).toMatchObject({
      credentialVersion: 2,
    });
  });

  it('restores the previous secret when the metadata transaction fails', async () => {
    const credentialStore = credentials();
    const transactionError = new Error('transaction failed');

    await expect(
      replace({
        credentials: credentialStore,
        updateConnection: vi.fn(() => Promise.reject(transactionError)),
      }),
    ).rejects.toBe(transactionError);

    expect(credentialStore.setApiKey).toHaveBeenNthCalledWith(1, {
      connectionId,
      workspaceId: current.workspaceId,
      apiKey: 'cla_new_key',
    });
    expect(credentialStore.setApiKey).toHaveBeenNthCalledWith(2, {
      connectionId,
      workspaceId: current.workspaceId,
      apiKey: 'cla_old',
    });
    expect(await getClaapInstallationByConnectionId(connectionId)).toMatchObject({
      keyHint: 'old1',
      credentialVersion: 1,
    });
  });
});
