import {
  AUTH_USER,
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {type AuthMethod, ClientError, closeApp} from '@shipfox/node-fastify';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import type {ClickUpApiClient} from '#api/client.js';
import type {ConnectClickUpInstallationInput} from '#core/install.js';
import type {ClickUpTokenStore} from '#core/tokens.js';

let authenticatedMemberships: UserContextMembership[] = [];
let impersonatorId: string | undefined;
let activeApp: FastifyInstance | undefined;

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
        impersonatorId,
      }),
    );
    return Promise.resolve();
  },
};

function clickupClient(overrides: Partial<ClickUpApiClient> = {}): ClickUpApiClient {
  return {
    exchangeAuthorizationCode: vi.fn(() => Promise.resolve({accessToken: 'access-token'})),
    getAuthorizedWorkspaces: vi.fn(() => Promise.resolve([{id: 'team-1', name: 'Acme'}])),
    getAuthorizedUser: vi.fn(() => Promise.resolve({id: 'clickup-user-1'})),
    ...overrides,
  };
}

function connection(input: Partial<IntegrationConnection<'clickup'>> = {}) {
  return {
    id: 'connection-1',
    workspaceId: 'workspace-1',
    provider: 'clickup',
    externalAccountId: 'team-1',
    slug: 'clickup_acme',
    displayName: 'ClickUp Acme',
    lifecycleStatus: 'active',
    repositoryAccessMode: 'selected',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...input,
  } satisfies IntegrationConnection<'clickup'>;
}

interface TestApp {
  app: FastifyInstance;
  clickup: ClickUpApiClient;
}

async function createTestApp(authBaseUrl = 'https://app.clickup.com'): Promise<TestApp> {
  vi.stubEnv('CLICKUP_AUTH_BASE_URL', authBaseUrl);
  vi.resetModules();
  const {createClickUpIntegrationRoutes} = await import('./install.js');
  const clickup = clickupClient();
  const tokenStore: Pick<ClickUpTokenStore, 'storeTokens'> = {
    storeTokens: vi.fn(() => Promise.resolve()),
  };
  const routes = createClickUpIntegrationRoutes({
    clickup,
    tokenStore,
    getExistingClickUpConnection: vi.fn(() => Promise.resolve(undefined)),
    connectClickUpInstallation: vi.fn((input: ConnectClickUpInstallationInput) =>
      Promise.resolve(connection({workspaceId: input.workspaceId})),
    ),
    disconnectClickUpInstallation: vi.fn(() => Promise.resolve()),
    connectionCapabilities: [],
    requireActiveWorkspaceMembership: vi.fn(() => Promise.resolve()),
  });
  const {createApp} = await import('@shipfox/node-fastify');
  const app = await createApp({auth: [fakeUserAuth], routes: [routes], swagger: false});
  await app.ready();
  activeApp = app;
  return {app, clickup};
}

describe('ClickUp integration routes', () => {
  beforeEach(async () => {
    authenticatedMemberships = [];
    impersonatorId = undefined;
    await closeApp();
  });

  afterEach(async () => {
    await activeApp?.close();
    activeApp = undefined;
    await closeApp();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('strips trailing slashes from the authorization base URL', async () => {
    const {app} = await createTestApp('https://clickup-auth.example.test///');
    const workspaceId = crypto.randomUUID();
    authenticatedMemberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/clickup/install',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId},
    });

    const installUrl = new URL(res.json().install_url);
    expect(res.statusCode).toBe(200);
    expect(installUrl.origin + installUrl.pathname).toBe('https://clickup-auth.example.test/api');
    expect(installUrl.searchParams.get('client_id')).toBe('test-client-id');
    expect(installUrl.searchParams.get('redirect_uri')).toBe(
      'https://shipfox.example.com/integrations/clickup/callback',
    );
    expect(installUrl.searchParams.get('state')).toBeTruthy();
  });

  it('rejects impersonated successful callbacks before exchanging the code', async () => {
    const {app, clickup} = await createTestApp();
    const workspaceId = crypto.randomUUID();
    authenticatedMemberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];

    const install = await app.inject({
      method: 'POST',
      url: '/integrations/clickup/install',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId},
    });
    const state = new URL(install.json().install_url).searchParams.get('state');
    if (!state) throw new Error('Install URL did not include state');

    impersonatorId = crypto.randomUUID();
    const res = await app.inject({
      method: 'GET',
      url: `/integrations/clickup/callback/api?code=code&state=${encodeURIComponent(state)}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('impersonation-not-permitted');
    expect(clickup.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });
});
