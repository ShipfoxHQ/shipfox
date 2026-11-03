import type {UserContextMembership} from '@shipfox/api-auth-context';
import {upsertIntegrationConnection} from '#db/connections.js';
import {createTestApp, sourceProvider, useIntegrationRouteTest} from '#test/route-utils.js';

const platform = {
  kind: 'repository',
  externalId: 'gitea:gitea-owner/platform',
  lookupName: 'gitea-owner/platform',
  displayName: 'gitea-owner/Platform',
};

function scopeProvider(overrides: Parameters<typeof sourceProvider>[0] = {}) {
  return sourceProvider({
    resourceKinds: [{kind: 'repository', label: 'Repositories'}],
    listScopeResources: vi.fn(() => Promise.resolve({resources: [platform], nextCursor: 'next'})),
    ...overrides,
  });
}

describe('GET /integration-connections/:connectionId/scope-resources', () => {
  const context = useIntegrationRouteTest();

  async function createConnection(
    overrides: Parameters<typeof upsertIntegrationConnection>[0] extends infer P
      ? Partial<P>
      : never = {},
  ) {
    return await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
      capabilities: ['source_control'],
      ...overrides,
    });
  }

  it('lists the resources of a kind for a workspace admin', async () => {
    const provider = scopeProvider();
    const app = await createTestApp([provider]);
    const connection = await createConnection();

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/scope-resources?kind=repository&limit=10&search=plat&cursor=c1`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      resources: [
        {
          kind: 'repository',
          external_id: platform.externalId,
          lookup_name: platform.lookupName,
          display_name: platform.displayName,
        },
      ],
      next_cursor: 'next',
    });
    expect(provider.listScopeResources).toHaveBeenCalledWith({
      connection: expect.objectContaining({id: connection.id}),
      kind: 'repository',
      limit: 10,
      cursor: 'c1',
      query: 'plat',
    });
  });

  it('requires the admin role', async () => {
    const app = await createTestApp([scopeProvider()], {
      memberships: [
        {
          workspaceId: context.workspaceId,
          role: 'member' as UserContextMembership['role'],
          workspaceStatus: 'active',
        },
      ],
    });
    const connection = await createConnection();

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/scope-resources?kind=repository`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });

  it('refuses a kind the provider does not declare', async () => {
    const app = await createTestApp([scopeProvider()]);
    const connection = await createConnection();

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/scope-resources?kind=team`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('integration-resource-kind-unsupported');
  });

  it('refuses an internal provider without listing its resources', async () => {
    const provider = scopeProvider({internal: true});
    const app = await createTestApp([provider]);
    const connection = await createConnection();

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/scope-resources?kind=repository`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('integration-resource-kind-unsupported');
    expect(provider.listScopeResources).not.toHaveBeenCalled();
  });

  it('refuses a provider that declares no resource kind', async () => {
    const app = await createTestApp([sourceProvider()]);
    const connection = await createConnection();

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/scope-resources?kind=repository`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('integration-resource-kind-unsupported');
  });

  it('returns 404 for a missing connection', async () => {
    const app = await createTestApp([scopeProvider()]);

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections/${crypto.randomUUID()}/scope-resources?kind=repository`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('integration-connection-not-found');
  });

  it('refuses an inactive connection', async () => {
    const app = await createTestApp([scopeProvider()]);
    const connection = await createConnection({lifecycleStatus: 'disabled'});

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/scope-resources?kind=repository`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('integration-connection-inactive');
  });
});
