import {
  AUTH_USER,
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import {ConnectionSlugConflictError} from '@shipfox/api-integration-spi';
import {type AuthMethod, ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import type {AzureDevOpsApiClient} from '#api/client.js';
import type {ConnectAzureDevOpsConnectionInput} from '#core/connect.js';
import type {AzureDevOpsIntegrationConnection} from '#core/credentials.js';
import {AzureDevOpsIntegrationProviderError} from '#core/errors.js';
import {createAzureDevOpsIntegrationProvider} from '#index.js';
import {azureDevOpsConnection, memorySecrets} from '#test/index.js';

let authenticatedMemberships: UserContextMembership[] = [];

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }
    setUserContext(
      request,
      buildUserContext({
        userId: 'user-1',
        email: 'user@example.com',
        memberships: authenticatedMemberships,
      }),
    );
    return Promise.resolve();
  },
};

function adoClient(overrides: Partial<AzureDevOpsApiClient> = {}): AzureDevOpsApiClient {
  const unused = () => Promise.reject(new Error('not used'));
  return {
    getConnectionData: vi.fn(() =>
      Promise.resolve({authenticatedUserId: 'user-1', displayName: 'Factory'}),
    ),
    listRepositories: vi.fn(() => Promise.resolve([])),
    getRepository: vi.fn(unused),
    resolveRef: vi.fn(unused),
    getBranch: vi.fn(unused),
    getTag: vi.fn(unused),
    listTree: vi.fn(unused),
    fetchFileContent: vi.fn(unused),
    getPullRequest: vi.fn(unused),
    createPullRequest: vi.fn(unused),
    createPullRequestComment: vi.fn(unused),
    ...overrides,
  };
}

interface CreateTestAppOptions {
  client?: AzureDevOpsApiClient;
  existingConnection?: AzureDevOpsIntegrationConnection | undefined;
  connectAzureDevOpsConnection?:
    | ((input: ConnectAzureDevOpsConnectionInput) => Promise<AzureDevOpsIntegrationConnection>)
    | undefined;
}

async function createTestApp(options: CreateTestAppOptions = {}): Promise<FastifyInstance> {
  const client = options.client ?? adoClient();
  const provider = createAzureDevOpsIntegrationProvider({
    createClient: () => client,
    secrets: memorySecrets(),
    getExistingAzureDevOpsConnection: vi.fn(() => Promise.resolve(options.existingConnection)),
    connectAzureDevOpsConnection:
      options.connectAzureDevOpsConnection ??
      vi.fn((input: ConnectAzureDevOpsConnectionInput) =>
        Promise.resolve(
          azureDevOpsConnection({
            workspaceId: input.workspaceId,
            externalAccountId: input.organization,
            displayName: input.displayName,
          }),
        ),
      ),
    discardAzureDevOpsConnection: vi.fn(() => Promise.resolve()),
    // Provider-level mounting includes webhook routes; these tests exercise only connections.
    coreDb: vi.fn() as never,
    publishSourcePush: vi.fn() as never,
    publishIntegrationEventReceived: vi.fn() as never,
    recordDeliveryOnly: vi.fn() as never,
    getIntegrationConnectionById: vi.fn() as never,
  });
  const app = await createApp({auth: [fakeUserAuth], routes: provider.routes, swagger: false});
  await app.ready();
  return app;
}

describe('Azure DevOps connection routes', () => {
  beforeEach(async () => {
    authenticatedMemberships = [];
    await closeApp();
  });

  afterEach(async () => {
    await closeApp();
  });

  function connect(app: FastifyInstance, workspaceId: string, authorization?: string) {
    return app.inject({
      method: 'POST',
      url: '/integrations/azure-devops/connections',
      headers: authorization ? {authorization} : {},
      payload: {workspace_id: workspaceId, organization: 'Contoso', token: 'the-pat'},
    });
  }

  function member(): string {
    const workspaceId = crypto.randomUUID();
    authenticatedMemberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
    return workspaceId;
  }

  it('requires auth to connect an organization', async () => {
    const app = await createTestApp();

    const res = await connect(app, crypto.randomUUID());

    expect(res.statusCode).toBe(401);
  });

  it('refuses a workspace the user is not a member of', async () => {
    const app = await createTestApp();
    member();

    const res = await connect(app, crypto.randomUUID(), 'Bearer user');

    expect(res.statusCode).toBe(403);
  });

  it('connects an organization and returns the connection with its Service Hook setup', async () => {
    const app = await createTestApp();
    const workspaceId = member();

    const res = await connect(app, workspaceId, 'Bearer user');

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      provider: 'azure-devops',
      external_account_id: 'contoso',
      lifecycle_status: 'active',
      capabilities: ['source_control', 'agent_tools'],
      external_url: 'https://dev.azure.example.com/contoso',
    });
    expect(body.service_hook.url).toBe(
      `https://hooks.shipfox.example.com/webhooks/integrations/azure-devops/${body.id}`,
    );
    expect(body.service_hook.username.startsWith('shipfox-')).toBe(true);
    expect(body.service_hook.password.length).toBeGreaterThanOrEqual(40);
    expect(JSON.stringify(body)).not.toContain('the-pat');
  });

  it('returns 422 azure-devops-credential-rejected when Azure DevOps refuses the token', async () => {
    const app = await createTestApp({
      client: adoClient({
        getConnectionData: vi.fn(() =>
          Promise.reject(
            new AzureDevOpsIntegrationProviderError('access-denied', 'denied', undefined, 302),
          ),
        ),
      }),
    });

    const res = await connect(app, member(), 'Bearer user');

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('azure-devops-credential-rejected');
  });

  it('returns 409 when the organization is linked to another workspace', async () => {
    const app = await createTestApp({
      existingConnection: azureDevOpsConnection({workspaceId: crypto.randomUUID()}),
    });

    const res = await connect(app, member(), 'Bearer user');

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('azure-devops-organization-already-linked');
  });

  it('returns 409 when the connection slug keeps conflicting', async () => {
    const app = await createTestApp({
      connectAzureDevOpsConnection: vi.fn(() =>
        Promise.reject(new ConnectionSlugConflictError(new Error('duplicate slug'))),
      ),
    });

    const res = await connect(app, member(), 'Bearer user');

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('slug-conflict');
  });

  it.each([
    ['rate-limited', 429],
    ['timeout', 503],
    ['provider-unavailable', 503],
    ['provider-rejected', 422],
  ] as const)('maps a %s provider error to %i', async (reason, status) => {
    const app = await createTestApp({
      client: adoClient({
        listRepositories: vi.fn(() =>
          Promise.reject(new AzureDevOpsIntegrationProviderError(reason, `${reason} happened`)),
        ),
      }),
    });

    const res = await connect(app, member(), 'Bearer user');

    expect(res.statusCode).toBe(status);
    expect(res.json().code).toBe(reason);
  });
});
