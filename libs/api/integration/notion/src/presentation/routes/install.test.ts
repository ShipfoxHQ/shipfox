import {
  AUTH_USER,
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {type AuthMethod, closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import type {NotionApiClient} from '#api/client.js';
import {verifyNotionInstallState} from '#core/state.js';
import {createNotionIntegrationProvider} from '#index.js';

let memberships: UserContextMembership[] = [];

const userAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    setUserContext(
      request,
      buildUserContext({
        userId: 'shipfox-user',
        email: 'user@example.com',
        memberships,
      }),
    );
    return Promise.resolve();
  },
};

function notionClient(): NotionApiClient {
  return {
    exchangeAuthorizationCode: vi.fn(),
    refreshAccessToken: vi.fn(),
    revokeToken: vi.fn(async () => undefined),
  };
}

function connection(workspaceId: string): IntegrationConnection<'notion'> {
  return {
    id: crypto.randomUUID(),
    workspaceId,
    provider: 'notion',
    externalAccountId: 'notion-workspace',
    slug: 'notion_acme',
    displayName: 'Notion Acme',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    repositoryAccessMode: 'selected',
  };
}

async function createTestApp() {
  const notion = notionClient();
  const provider = createNotionIntegrationProvider({
    routes: {
      notion,
      tokenStore: {
        storeTokens: vi.fn(async () => undefined),
        getTokens: vi.fn(async () => ({accessToken: 'old-token'})),
      },
      getExistingNotionConnection: vi.fn(async () => undefined),
      getNotionInstallationByConnectionId: vi.fn(async () => undefined),
      connectNotionInstallation: vi.fn(async (input) => connection(input.workspaceId)),
      restoreNotionInstallation: vi.fn(async (installation) => installation),
      disconnectNotionInstallation: vi.fn(async () => undefined),
      requireActiveWorkspaceMembership: vi.fn(async () => undefined),
    },
  });
  const app = await createApp({auth: [userAuth], routes: provider.routes, swagger: false});
  await app.ready();
  return {app, notion};
}

describe('Notion OAuth routes', () => {
  beforeEach(() => {
    memberships = [];
  });

  afterEach(async () => {
    await closeApp();
  });

  it('returns a signed Notion authorization URL with owner=user', async () => {
    const {app} = await createTestApp();
    const workspaceId = crypto.randomUUID();
    memberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/notion/install',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId},
    });

    const installUrl = new URL(response.json().install_url);
    const state = installUrl.searchParams.get('state');
    const setCookie = String(response.headers['set-cookie']);
    const nonce = setCookie.split(';')[0]?.split('=')[1];
    expect(response.statusCode).toBe(200);
    expect(installUrl.origin + installUrl.pathname).toBe(
      'https://api.notion.com/v1/oauth/authorize',
    );
    expect(installUrl.searchParams.get('owner')).toBe('user');
    expect(installUrl.searchParams.get('response_type')).toBe('code');
    expect(installUrl.searchParams.get('client_id')).toBe('test-client-id');
    expect(setCookie).toContain('shipfox_notion_install_state=');
    expect(setCookie).toContain('Max-Age=1800');
    expect(setCookie).toContain('Path=/integrations/notion');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(verifyNotionInstallState(state ?? '', {nonce}).workspaceId).toBe(workspaceId);
  });

  it('requires the browser-bound state cookie before exchanging the code', async () => {
    const {app, notion} = await createTestApp();
    const workspaceId = crypto.randomUUID();
    memberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
    const install = await app.inject({
      method: 'POST',
      url: '/integrations/notion/install',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId},
    });
    const state = new URL(install.json().install_url).searchParams.get('state');

    const response = await app.inject({
      method: 'GET',
      url: `/integrations/notion/callback/api?code=code&state=${encodeURIComponent(state ?? '')}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('invalid-notion-install-state');
    expect(notion.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('returns denied consent without exchanging a code', async () => {
    const {app, notion} = await createTestApp();
    const workspaceId = crypto.randomUUID();
    memberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
    const install = await app.inject({
      method: 'POST',
      url: '/integrations/notion/install',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId},
    });
    const state = new URL(install.json().install_url).searchParams.get('state');
    const cookieHeader = String(install.headers['set-cookie']).split(';')[0];

    const response = await app.inject({
      method: 'GET',
      url: `/integrations/notion/callback/api?error=access_denied&state=${encodeURIComponent(state ?? '')}`,
      headers: {authorization: 'Bearer user', cookie: cookieHeader},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({outcome: 'access_denied'});
    expect(String(response.headers['set-cookie'])).toContain(
      'shipfox_notion_install_state=; Max-Age=0',
    );
    expect(notion.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });
});
