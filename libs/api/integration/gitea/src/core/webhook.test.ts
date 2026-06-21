import {randomUUID} from 'node:crypto';
import type {IntegrationConnection} from '@shipfox/api-integration-core-dto';
import {db} from '#db/db.js';
import {giteaConnections} from '#db/schema/connections.js';
import {capturedGiteaPushPayload, giteaConnectionFactory, giteaPushPayload} from '#test/index.js';
import {
  GiteaWebhookMalformedJsonError,
  GiteaWebhookMalformedPushPayloadError,
  handleGiteaWebhook,
} from './webhook.js';

function fakeConnection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    provider: 'gitea',
    externalAccountId: 'shipfox',
    displayName: 'Gitea shipfox',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function deps(options: {connection?: IntegrationConnection} = {}) {
  return {
    publishSourcePush: vi.fn(() => Promise.resolve({published: true})),
    recordDeliveryOnly: vi.fn(() => Promise.resolve()),
    getIntegrationConnectionById: vi.fn(() =>
      Promise.resolve(options.connection ?? fakeConnection()),
    ),
  };
}

async function seedConnection(org: string, connectionId?: string): Promise<void> {
  await giteaConnectionFactory.create({
    org,
    ...(connectionId !== undefined && {connectionId}),
  });
}

describe('handleGiteaWebhook', () => {
  beforeEach(async () => {
    await db().delete(giteaConnections);
  });

  it('publishes a mapped event for a valid push from a connected org', async () => {
    const connection = fakeConnection();
    await seedConnection('shipfox', connection.id);
    const deliveryId = randomUUID();
    const handlers = deps({connection});
    const rawBody = JSON.stringify(
      giteaPushPayload({
        owner: 'shipfox',
        repo: 'api',
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'abc123',
      }),
    );

    const result = await handleGiteaWebhook({
      tx: db(),
      deliveryId,
      event: 'push',
      rawBody,
      ...handlers,
    });

    expect(result.outcome).toBe('published');
    expect(handlers.recordDeliveryOnly).not.toHaveBeenCalled();
    expect(handlers.getIntegrationConnectionById).toHaveBeenCalledTimes(1);
    expect(handlers.getIntegrationConnectionById).toHaveBeenCalledWith(
      connection.id,
      expect.objectContaining({tx: expect.anything()}),
    );
    expect(handlers.publishSourcePush).toHaveBeenCalledTimes(1);
    const call = handlers.publishSourcePush.mock.calls[0]?.[0];
    expect(call.tx).toBeDefined();
    expect(call).toMatchObject({
      provider: 'gitea',
      deliveryId,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      push: {
        externalRepositoryId: 'gitea:shipfox/api',
        ref: 'main',
        headCommitSha: 'abc123',
        isDefaultBranch: true,
      },
    });
  });

  it('accepts the captured local Gitea push payload shape', async () => {
    const connection = fakeConnection();
    await seedConnection('shipfox-demo', connection.id);
    const handlers = deps({connection});
    const deliveryId = randomUUID();

    const result = await handleGiteaWebhook({
      tx: db(),
      deliveryId,
      event: 'push',
      rawBody: JSON.stringify(capturedGiteaPushPayload),
      ...handlers,
    });

    expect(result.outcome).toBe('published');
    expect(handlers.publishSourcePush).toHaveBeenCalledTimes(1);
    expect(handlers.publishSourcePush.mock.calls[0]?.[0]).toMatchObject({
      provider: 'gitea',
      deliveryId,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      push: {
        externalRepositoryId: 'gitea:shipfox-demo/api',
        ref: 'main',
        headCommitSha: capturedGiteaPushPayload.after,
        defaultBranch: 'main',
        isDefaultBranch: true,
      },
    });
  });

  it('publishes with isDefaultBranch=false when ref is not the default branch', async () => {
    await seedConnection('shipfox');
    const handlers = deps();
    const rawBody = JSON.stringify(
      giteaPushPayload({
        owner: 'shipfox',
        repo: 'api',
        ref: 'refs/heads/feature/x',
        defaultBranch: 'main',
        sha: 'feat1',
      }),
    );

    const result = await handleGiteaWebhook({
      tx: db(),
      deliveryId: randomUUID(),
      event: 'push',
      rawBody,
      ...handlers,
    });

    expect(result.outcome).toBe('published');
    expect(handlers.publishSourcePush).toHaveBeenCalledTimes(1);
    expect(handlers.publishSourcePush.mock.calls[0]?.[0].push).toMatchObject({
      ref: 'feature/x',
      isDefaultBranch: false,
    });
  });

  it('resolves a mixed-case owner against the lower-cased stored org', async () => {
    const connection = fakeConnection();
    await seedConnection('shipfox', connection.id);
    const handlers = deps({connection});
    const rawBody = JSON.stringify(
      giteaPushPayload({
        owner: 'ShipFox',
        repo: 'API',
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'casing',
      }),
    );

    const result = await handleGiteaWebhook({
      tx: db(),
      deliveryId: randomUUID(),
      event: 'push',
      rawBody,
      ...handlers,
    });

    expect(result.outcome).toBe('published');
    expect(handlers.publishSourcePush).toHaveBeenCalledTimes(1);
    // Repo id keeps the payload's verbatim casing to match the source-control adapter.
    expect(handlers.publishSourcePush.mock.calls[0]?.[0].push.externalRepositoryId).toBe(
      'gitea:ShipFox/API',
    );
  });

  it('ignores a branch deletion without publishing', async () => {
    const connection = fakeConnection();
    await seedConnection('shipfox', connection.id);
    const handlers = deps({connection});
    const rawBody = JSON.stringify(
      giteaPushPayload({
        owner: 'shipfox',
        repo: 'api',
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: '0000000000000000000000000000000000000000',
      }),
    );

    const result = await handleGiteaWebhook({
      tx: db(),
      deliveryId: randomUUID(),
      event: 'push',
      rawBody,
      ...handlers,
    });

    expect(result.outcome).toBe('deleted');
    expect(handlers.publishSourcePush).not.toHaveBeenCalled();
    expect(handlers.recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('records the delivery only for non-push events', async () => {
    const handlers = deps();
    const deliveryId = randomUUID();

    const result = await handleGiteaWebhook({
      tx: db(),
      deliveryId,
      event: 'create',
      rawBody: JSON.stringify({hello: 'world'}),
      ...handlers,
    });

    expect(result.outcome).toBe('recorded-only');
    expect(handlers.publishSourcePush).not.toHaveBeenCalled();
    expect(handlers.recordDeliveryOnly).toHaveBeenCalledTimes(1);
    expect(handlers.recordDeliveryOnly.mock.calls[0]?.[0]).toMatchObject({
      provider: 'gitea',
      deliveryId,
    });
  });

  it('records the delivery only for pushes from an unknown org', async () => {
    const handlers = deps();
    const deliveryId = randomUUID();
    const rawBody = JSON.stringify(
      giteaPushPayload({
        owner: 'ghost',
        repo: 'api',
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'orphan',
      }),
    );

    const result = await handleGiteaWebhook({
      tx: db(),
      deliveryId,
      event: 'push',
      rawBody,
      ...handlers,
    });

    expect(result.outcome).toBe('unknown-org');
    expect(handlers.publishSourcePush).not.toHaveBeenCalled();
    expect(handlers.getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(handlers.recordDeliveryOnly).toHaveBeenCalledTimes(1);
    expect(handlers.recordDeliveryOnly.mock.calls[0]?.[0]).toMatchObject({
      provider: 'gitea',
      deliveryId,
    });
  });

  it('records the delivery only when the org has no core connection', async () => {
    const handlers = deps();
    handlers.getIntegrationConnectionById.mockResolvedValue(undefined);
    await seedConnection('shipfox');
    const deliveryId = randomUUID();
    const rawBody = JSON.stringify(
      giteaPushPayload({
        owner: 'shipfox',
        repo: 'api',
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'dangling',
      }),
    );

    const result = await handleGiteaWebhook({
      tx: db(),
      deliveryId,
      event: 'push',
      rawBody,
      ...handlers,
    });

    expect(result.outcome).toBe('unknown-org');
    expect(handlers.getIntegrationConnectionById).toHaveBeenCalledTimes(1);
    expect(handlers.publishSourcePush).not.toHaveBeenCalled();
    expect(handlers.recordDeliveryOnly).toHaveBeenCalledTimes(1);
    expect(handlers.recordDeliveryOnly.mock.calls[0]?.[0]).toMatchObject({
      provider: 'gitea',
      deliveryId,
    });
  });

  it('rejects malformed JSON', async () => {
    const handlers = deps();

    const result = handleGiteaWebhook({
      tx: db(),
      deliveryId: randomUUID(),
      event: 'push',
      rawBody: '{not valid json',
      ...handlers,
    });

    await expect(result).rejects.toBeInstanceOf(GiteaWebhookMalformedJsonError);
    expect(handlers.publishSourcePush).not.toHaveBeenCalled();
    expect(handlers.recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('rejects push payloads that fail schema validation', async () => {
    const handlers = deps();

    const result = handleGiteaWebhook({
      tx: db(),
      deliveryId: randomUUID(),
      event: 'push',
      rawBody: JSON.stringify({ref: 'refs/heads/main'}),
      ...handlers,
    });

    await expect(result).rejects.toBeInstanceOf(GiteaWebhookMalformedPushPayloadError);
    expect(handlers.publishSourcePush).not.toHaveBeenCalled();
    expect(handlers.recordDeliveryOnly).not.toHaveBeenCalled();
  });
});
