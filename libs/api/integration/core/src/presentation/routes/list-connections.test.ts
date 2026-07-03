import {ClientError} from '@shipfox/node-fastify';
import {upsertIntegrationConnection} from '#db/connections.js';
import {
  createTestApp,
  requireMembershipMock,
  sourceProvider,
  useIntegrationRouteTest,
} from '#test/route-utils.js';

describe('GET /integration-connections', () => {
  const context = useIntegrationRouteTest();

  it('lists workspace connections across all lifecycle statuses', async () => {
    const app = await createTestApp([sourceProvider()]);
    await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'debug-active',
      slug: 'debug_active',
      displayName: 'Gitea',
    });
    await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'debug-error',
      slug: 'debug_error',
      displayName: 'Gitea',
      lifecycleStatus: 'error',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections?workspace_id=${context.workspaceId}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(
      res
        .json()
        .connections.map((connection: {lifecycle_status: string}) => connection.lifecycle_status),
    ).toEqual(['active', 'error']);
  });

  it('drops connections whose provider misses the capability filter', async () => {
    const app = await createTestApp([sourceProvider()]);
    await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
    });
    await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'github',
      externalAccountId: 'team-1',
      slug: 'github_team_1',
      displayName: 'GitHub',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections?workspace_id=${context.workspaceId}&capability=source_control`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(
      res.json().connections.map((connection: {provider: string}) => connection.provider),
    ).toEqual(['gitea']);
  });

  it('includes external_url when the provider resolves one', async () => {
    const app = await createTestApp([
      sourceProvider({
        connectionExternalUrl: () => Promise.resolve('https://gitea.local/team'),
      }),
    ]);
    await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections?workspace_id=${context.workspaceId}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().connections[0].external_url).toBe('https://gitea.local/team');
  });

  it('omits external_url and keeps the list alive when the provider lookup throws', async () => {
    const app = await createTestApp([
      sourceProvider({
        connectionExternalUrl: () => Promise.reject(new Error('installation row missing')),
      }),
    ]);
    await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections?workspace_id=${context.workspaceId}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().connections).toHaveLength(1);
    expect(res.json().connections[0].external_url).toBeUndefined();
  });

  it('returns membership errors', async () => {
    const app = await createTestApp([sourceProvider()]);
    requireMembershipMock.mockRejectedValueOnce(
      new ClientError('Not a member of this workspace', 'forbidden', {status: 403}),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections?workspace_id=${context.workspaceId}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });
});
