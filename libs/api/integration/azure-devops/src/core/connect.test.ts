import type {AzureDevOpsApiClient} from '#api/client.js';
import {azureDevOpsConnection, memorySecrets} from '#test/index.js';
import {handleAzureDevOpsConnect} from './connect.js';
import {
  AzureDevOpsCredentialRejectedError,
  AzureDevOpsIntegrationProviderError,
  AzureDevOpsOrganizationAlreadyLinkedError,
} from './errors.js';

const HOOK_USERNAME_RE = /^shipfox-[0-9a-f]{12}$/;

function client(overrides: Partial<AzureDevOpsApiClient> = {}): AzureDevOpsApiClient {
  return {
    getConnectionData: vi.fn(() =>
      Promise.resolve({authenticatedUserId: 'user-1', displayName: 'Factory'}),
    ),
    listRepositories: vi.fn(() => Promise.resolve([])),
    getRepository: vi.fn(),
    resolveRef: vi.fn(),
    getBranch: vi.fn(),
    getTag: vi.fn(),
    listTree: vi.fn(),
    fetchFileContent: vi.fn(),
    getPullRequest: vi.fn(),
    createPullRequest: vi.fn(),
    createPullRequestComment: vi.fn(),
    ...overrides,
  };
}

function setup(adoClient = client()) {
  const workspaceId = crypto.randomUUID();
  const secrets = memorySecrets();
  const createClient = vi.fn(() => adoClient);
  const connection = azureDevOpsConnection({workspaceId});
  const connectAzureDevOpsConnection = vi.fn((input: {webhookUsername: string}) =>
    Promise.resolve({connection, webhookUsername: input.webhookUsername}),
  );
  const getExistingAzureDevOpsConnection = vi.fn(
    (_input: {
      organization: string;
    }): Promise<ReturnType<typeof azureDevOpsConnection> | undefined> => Promise.resolve(undefined),
  );
  const discardAzureDevOpsConnection = vi.fn(() => Promise.resolve());
  const params = {
    createClient,
    secrets,
    workspaceId,
    organization: 'Contoso',
    token: 'the-pat',
    getExistingAzureDevOpsConnection,
    connectAzureDevOpsConnection,
    discardAzureDevOpsConnection,
  };
  return {
    params,
    secrets,
    connection,
    createClient,
    connectAzureDevOpsConnection,
    discardAzureDevOpsConnection,
  };
}

describe('handleAzureDevOpsConnect', () => {
  it('checks the token against the lower-cased organization before storing anything', async () => {
    const {params, createClient, connectAzureDevOpsConnection} = setup();

    await handleAzureDevOpsConnect(params);

    expect(createClient).toHaveBeenCalledWith({
      organization: 'contoso',
      credential: {kind: 'pat', token: 'the-pat'},
    });
    expect(connectAzureDevOpsConnection).toHaveBeenCalledWith(
      expect.objectContaining({organization: 'contoso', displayName: 'Azure DevOps contoso'}),
    );
    // The cross-workspace guard compares the stored, lower-cased name.
    expect(params.getExistingAzureDevOpsConnection).toHaveBeenCalledWith({organization: 'contoso'});
  });

  it('removes a new connection again when its secrets cannot be stored', async () => {
    const {params, secrets, connection, discardAzureDevOpsConnection} = setup();
    secrets.setSecrets.mockRejectedValueOnce(new Error('secrets unavailable'));

    await expect(handleAzureDevOpsConnect(params)).rejects.toThrow('secrets unavailable');
    expect(discardAzureDevOpsConnection).toHaveBeenCalledWith(connection);
  });

  it('keeps an existing connection when reconnecting fails to store secrets', async () => {
    const {params, secrets, connection, discardAzureDevOpsConnection} = setup();
    params.getExistingAzureDevOpsConnection.mockResolvedValue(connection);
    secrets.setSecrets.mockRejectedValueOnce(new Error('secrets unavailable'));

    await expect(handleAzureDevOpsConnect(params)).rejects.toThrow('secrets unavailable');
    expect(discardAzureDevOpsConnection).not.toHaveBeenCalled();
  });

  it('stores the token and a fresh hook password in the connection secrets and returns the hook setup once', async () => {
    const {params, secrets, connection} = setup();

    const result = await handleAzureDevOpsConnect(params);

    const namespace = connection.id;
    const stored = (key: string) =>
      secrets.store.get(`${connection.workspaceId}/${namespace}/${key}`);
    expect(stored('credential_kind')).toBe('pat');
    expect(stored('credential_token')).toBe('the-pat');
    expect(stored('webhook_password')).toBe(result.serviceHook.password);
    expect(result.serviceHook.password.length).toBeGreaterThanOrEqual(40);
    expect(result.serviceHook.url).toBe(
      `https://hooks.shipfox.example.com/webhooks/integrations/azure-devops/${connection.id}`,
    );
    expect(result.serviceHook.username).toMatch(HOOK_USERNAME_RE);
  });

  it('issues different hook credentials on every connect', async () => {
    const first = setup();
    const second = setup();

    const a = await handleAzureDevOpsConnect(first.params);
    const b = await handleAzureDevOpsConnect(second.params);

    expect(a.serviceHook.password).not.toBe(b.serviceHook.password);
    expect(a.serviceHook.username).not.toBe(b.serviceHook.username);
  });

  it('rejects a token Azure DevOps does not accept, without creating a connection', async () => {
    const {params, connectAzureDevOpsConnection, secrets} = setup(
      client({
        getConnectionData: vi.fn(() =>
          Promise.reject(new AzureDevOpsIntegrationProviderError('access-denied', 'nope')),
        ),
      }),
    );

    await expect(handleAzureDevOpsConnect(params)).rejects.toBeInstanceOf(
      AzureDevOpsCredentialRejectedError,
    );
    expect(connectAzureDevOpsConnection).not.toHaveBeenCalled();
    expect(secrets.setSecrets).not.toHaveBeenCalled();
  });

  it('refuses an organization another workspace already connected', async () => {
    const {params, connectAzureDevOpsConnection} = setup();
    params.getExistingAzureDevOpsConnection.mockResolvedValue(
      azureDevOpsConnection({workspaceId: crypto.randomUUID()}) as never,
    );

    await expect(handleAzureDevOpsConnect(params)).rejects.toBeInstanceOf(
      AzureDevOpsOrganizationAlreadyLinkedError,
    );
    expect(connectAzureDevOpsConnection).not.toHaveBeenCalled();
  });
});
