import {ClientError} from '@shipfox/node-fastify';
import {getIntegrationConnectionById, upsertIntegrationConnection} from '#db/connections.js';
import {
  createTestApp,
  requireMembershipMock,
  sourceProvider,
  useIntegrationRouteTest,
} from '#test/route-utils.js';

describe('PATCH /integration-connections/:connectionId', () => {
  const context = useIntegrationRouteTest();

  it('updates a connection lifecycle status', async () => {
    const app = await createTestApp([sourceProvider()]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      slug: 'debug',
      displayName: 'Debug',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
      payload: {lifecycle_status: 'disabled'},
    });

    const reloaded = await getIntegrationConnectionById(connection.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().lifecycle_status).toBe('disabled');
    expect(res.json().capabilities).toEqual(['source_control']);
    expect(reloaded?.lifecycleStatus).toBe('disabled');
  });

  it('returns not-found for a missing connection', async () => {
    const app = await createTestApp([sourceProvider()]);

    const res = await app.inject({
      method: 'PATCH',
      url: `/integration-connections/${crypto.randomUUID()}`,
      headers: {authorization: 'Bearer user'},
      payload: {lifecycle_status: 'disabled'},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  it('returns membership errors', async () => {
    const app = await createTestApp([sourceProvider()]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      slug: 'debug',
      displayName: 'Debug',
    });
    requireMembershipMock.mockRejectedValueOnce(
      new ClientError('Not a member of this workspace', 'forbidden', {status: 403}),
    );

    const res = await app.inject({
      method: 'PATCH',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
      payload: {lifecycle_status: 'disabled'},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });
});

describe('DELETE /integration-connections/:connectionId', () => {
  const context = useIntegrationRouteTest();

  it('deletes a connection', async () => {
    const app = await createTestApp([sourceProvider()]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      slug: 'debug',
      displayName: 'Debug',
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    const reloaded = await getIntegrationConnectionById(connection.id);
    expect(res.statusCode).toBe(204);
    expect(reloaded).toBeUndefined();
  });

  it('returns not-found for a missing connection', async () => {
    const app = await createTestApp([sourceProvider()]);

    const res = await app.inject({
      method: 'DELETE',
      url: `/integration-connections/${crypto.randomUUID()}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });
});
