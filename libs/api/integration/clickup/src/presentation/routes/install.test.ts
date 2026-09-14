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
import {verifyClickUpInstallState} from '#core/state.js';
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
    createWebhook: vi.fn(() => Promise.resolve({id: 'webhook-1', secret: 'webhook-secret'})),
    deleteWebhook: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function connection(input: Partial<IntegrationConnection<'clickup'>> = {}) {
  return {
    id: crypto.randomUUID(),
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
  const {createClickUpIntegrationProvider} = await import('#index.js');
  const clickup = clickupClient();
  const tokenStore: Pick<ClickUpTokenStore, 'getAccessToken' | 'storeTokens'> = {
    getAccessToken: vi.fn(() => Promise.resolve('access-token')),
    storeTokens: vi.fn(() => Promise.resolve()),
  };
  const provider = createClickUpIntegrationProvider({
    clickup,
    agentTools: {tokenStore},
    routes: {
      tokenStore,
      getExistingClickUpConnection: vi.fn(() => Promise.resolve(undefined)),
      connectClickUpInstallation: vi.fn((input: ConnectClickUpInstallationInput) =>
        Promise.resolve(connection({workspaceId: input.workspaceId})),
      ),
      disconnectClickUpInstallation: vi.fn(() => Promise.resolve()),
      updateClickUpInstallationWebhook: vi.fn(() => Promise.resolve({id: 'installation-1'})),
      markConnectionActive: vi.fn(() =>
        Promise.resolve(
          connection({
            workspaceId: authenticatedMemberships[0]?.workspaceId ?? crypto.randomUUID(),
          }),
        ),
      ),
      markConnectionError: vi.fn(() => Promise.resolve()),
      webhookUrlForConnection: (connectionId) =>
        `https://shipfox.example.test/webhooks/${connectionId}`,
      withClickUpInstallationLock: async (_teamId, fn) => await fn(),
      requireActiveWorkspaceMembership: vi.fn(() => Promise.resolve()),
    },
  });
  const {createApp} = await import('@shipfox/node-fastify');
  const app = await createApp({auth: [fakeUserAuth], routes: provider.routes, swagger: false});
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
    const state = installUrl.searchParams.get('state');
    const setCookie = String(res.headers['set-cookie']);
    const nonce = setCookie.split(';')[0]?.split('=')[1];
    expect(state).toBeTruthy();
    expect(setCookie).toContain('shipfox_clickup_install_state=');
    expect(setCookie).toContain('Max-Age=1800');
    expect(setCookie).toContain('Path=/integrations/clickup');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(() => verifyClickUpInstallState(state ?? '', {nonce})).not.toThrow();
  });

  it('requires and consumes the browser-bound state cookie', async () => {
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
    const cookieHeader = String(install.headers['set-cookie']).split(';')[0];
    if (!state || !cookieHeader) throw new Error('Install response did not include state binding');

    const missingCookie = await app.inject({
      method: 'GET',
      url: `/integrations/clickup/callback/api?code=code&state=${encodeURIComponent(state)}`,
      headers: {authorization: 'Bearer user'},
    });
    const callback = await app.inject({
      method: 'GET',
      url: `/integrations/clickup/callback/api?code=code&state=${encodeURIComponent(state)}`,
      headers: {authorization: 'Bearer user', cookie: cookieHeader},
    });

    expect(missingCookie.statusCode).toBe(400);
    expect(missingCookie.json().code).toBe('invalid-clickup-install-state');
    expect(clickup.exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
    expect(callback.statusCode, callback.body).toBe(200);
    expect(callback.json().capabilities).toEqual(['agent_tools']);
    expect(String(callback.headers['set-cookie'])).toContain(
      'shipfox_clickup_install_state=; Max-Age=0',
    );
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
