import {upsertGithubInstallation} from '@shipfox/api-integration-github';
import {
  getIntegrationConnectionById,
  listIntegrationConnections,
  updateIntegrationConnectionLifecycleStatus,
  upsertIntegrationConnection,
} from './connections.js';
import {db} from './db.js';

describe('integration connection queries', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  it('upserts duplicate external connections for a workspace', async () => {
    const first = await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      displayName: 'Debug',
    });

    const second = await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      displayName: 'Renamed Debug',
    });

    expect(second.id).toBe(first.id);
    expect(second.displayName).toBe('Renamed Debug');
  });

  it('allows multiple same-provider connections when external account differs', async () => {
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug-1',
      displayName: 'Debug One',
    });
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug-2',
      displayName: 'Debug Two',
    });

    const result = await listIntegrationConnections({workspaceId});

    expect(result).toHaveLength(2);
  });

  it('lists workspace connections across all lifecycle statuses', async () => {
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      displayName: 'Debug',
    });
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'github',
      externalAccountId: 'team-1',
      displayName: 'GitHub',
    });
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'github',
      externalAccountId: 'installation-1',
      displayName: 'GitHub',
      lifecycleStatus: 'disabled',
    });

    const result = await listIntegrationConnections({workspaceId});

    expect(result.map((connection) => [connection.provider, connection.lifecycleStatus])).toEqual([
      ['debug', 'active'],
      ['github', 'active'],
      ['github', 'disabled'],
    ]);
  });

  it('updates a connection lifecycle status and returns the mapped connection', async () => {
    const connection = await upsertIntegrationConnection({
      workspaceId,
      provider: 'sentry',
      externalAccountId: 'install-uuid',
      displayName: 'Sentry acme',
    });

    const updated = await updateIntegrationConnectionLifecycleStatus({
      id: connection.id,
      lifecycleStatus: 'disabled',
    });

    expect(updated?.lifecycleStatus).toBe('disabled');
    const reloaded = await getIntegrationConnectionById(connection.id);
    expect(reloaded?.lifecycleStatus).toBe('disabled');
  });

  it('returns undefined when updating the lifecycle status of an unknown connection', async () => {
    const result = await updateIntegrationConnectionLifecycleStatus({
      id: crypto.randomUUID(),
      lifecycleStatus: 'disabled',
    });

    expect(result).toBeUndefined();
  });

  it('rolls back a connection when provider-specific installation persistence fails', async () => {
    const result = db().transaction(async (tx) => {
      const connection = await upsertIntegrationConnection(
        {
          workspaceId,
          provider: 'github',
          externalAccountId: '123',
          displayName: 'GitHub shipfox',
        },
        {tx},
      );

      await upsertGithubInstallation(
        {
          connectionId: connection.id,
          installationId: '123',
          accountLogin: null as unknown as string,
          accountType: 'Organization',
          repositorySelection: 'all',
          latestEvent: {id: 123},
        },
        {tx},
      );
    });

    await expect(result).rejects.toThrow();

    const connections = await listIntegrationConnections({workspaceId});
    expect(connections).toHaveLength(0);
  });
});
