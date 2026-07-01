import {ConnectionSlugConflictError} from '@shipfox/api-integration-core-dto';
import {upsertGithubInstallation} from '@shipfox/api-integration-github';
import {IntegrationConnectionAlreadyExistsError} from '#core/errors.js';
import {
  createIntegrationConnection,
  deleteIntegrationConnection,
  getIntegrationConnectionById,
  listIntegrationConnections,
  listIntegrationConnectionsByProvider,
  resolveUniqueConnectionSlug,
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
      slug: 'debug',
      displayName: 'Debug',
    });

    const second = await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      slug: 'debug_renamed',
      displayName: 'Renamed Debug',
    });

    expect(second.id).toBe(first.id);
    expect(second.displayName).toBe('Renamed Debug');
    expect(second.slug).toBe('debug');
  });

  it('allows multiple same-provider connections when external account differs', async () => {
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug-1',
      slug: 'debug_1',
      displayName: 'Debug One',
    });
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug-2',
      slug: 'debug_2',
      displayName: 'Debug Two',
    });

    const result = await listIntegrationConnections({workspaceId});

    expect(result).toHaveLength(2);
  });

  it('resolves a unique slug in workspace scope', async () => {
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug-1',
      slug: 'debug',
      displayName: 'Debug One',
    });
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'github',
      externalAccountId: 'debug-2',
      slug: 'debug_2',
      displayName: 'Debug Two',
    });

    const result = await resolveUniqueConnectionSlug({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug-3',
      baseSlug: 'debug',
    });

    expect(result).toBe('debug_3');
  });

  it('keeps the existing slug when resolving a reconnect', async () => {
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'sentry',
      externalAccountId: 'install-uuid',
      slug: 'sentry_prod',
      displayName: 'Sentry',
    });

    const result = await resolveUniqueConnectionSlug({
      workspaceId,
      provider: 'sentry',
      externalAccountId: 'install-uuid',
      baseSlug: 'sentry_renamed',
    });

    expect(result).toBe('sentry_prod');
  });

  it('creates a connection without upserting duplicates', async () => {
    const first = await createIntegrationConnection({
      workspaceId,
      provider: 'webhook',
      externalAccountId: 'stripe',
      slug: 'stripe',
      displayName: 'Stripe',
    });

    const result = createIntegrationConnection({
      workspaceId,
      provider: 'webhook',
      externalAccountId: 'stripe',
      slug: 'stripe_renamed',
      displayName: 'Renamed Stripe',
    });

    await expect(result).rejects.toBeInstanceOf(IntegrationConnectionAlreadyExistsError);
    const connections = await listIntegrationConnections({workspaceId});
    expect(connections).toHaveLength(1);
    expect(connections[0]?.id).toBe(first.id);
    expect(connections[0]?.displayName).toBe('Stripe');
  });

  it('reports slug collisions separately from duplicate external accounts', async () => {
    await createIntegrationConnection({
      workspaceId,
      provider: 'webhook',
      externalAccountId: 'stripe',
      slug: 'stripe',
      displayName: 'Stripe',
    });

    const result = createIntegrationConnection({
      workspaceId,
      provider: 'webhook',
      externalAccountId: 'stripe-prod',
      slug: 'stripe',
      displayName: 'Stripe prod',
    });

    await expect(result).rejects.toBeInstanceOf(ConnectionSlugConflictError);
  });

  it('lists workspace connections across all lifecycle statuses', async () => {
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      slug: 'debug',
      displayName: 'Debug',
    });
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'github',
      externalAccountId: 'team-1',
      slug: 'github_team_1',
      displayName: 'GitHub',
    });
    await upsertIntegrationConnection({
      workspaceId,
      provider: 'github',
      externalAccountId: 'installation-1',
      slug: 'github_installation_1',
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

  it('lists connections for a provider across all workspaces', async () => {
    const otherWorkspaceId = crypto.randomUUID();
    const debugA = await upsertIntegrationConnection({
      workspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      slug: 'debug',
      displayName: 'Debug',
    });
    const debugB = await upsertIntegrationConnection({
      workspaceId: otherWorkspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      slug: 'debug',
      displayName: 'Debug',
    });
    const github = await upsertIntegrationConnection({
      workspaceId,
      provider: 'github',
      externalAccountId: 'gh-1',
      slug: 'github_gh_1',
      displayName: 'GitHub',
    });

    const result = await listIntegrationConnectionsByProvider({provider: 'debug'});

    const ids = result.map((connection) => connection.id);
    expect(result.every((connection) => connection.provider === 'debug')).toBe(true);
    expect(ids).toEqual(expect.arrayContaining([debugA.id, debugB.id]));
    expect(ids).not.toContain(github.id);
  });

  it('updates a connection lifecycle status and returns the mapped connection', async () => {
    const connection = await upsertIntegrationConnection({
      workspaceId,
      provider: 'sentry',
      externalAccountId: 'install-uuid',
      slug: 'sentry_install_uuid',
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

  it('deletes a connection and reports whether a row was removed', async () => {
    const connection = await upsertIntegrationConnection({
      workspaceId,
      provider: 'webhook',
      externalAccountId: 'stripe',
      slug: 'stripe',
      displayName: 'Stripe',
    });

    const deleted = await deleteIntegrationConnection({id: connection.id});
    const deletedAgain = await deleteIntegrationConnection({id: connection.id});

    expect(deleted).toBe(true);
    expect(deletedAgain).toBe(false);
    expect(await getIntegrationConnectionById(connection.id)).toBeUndefined();
  });

  it('rolls back a connection when provider-specific installation persistence fails', async () => {
    const result = db().transaction(async (tx) => {
      const connection = await upsertIntegrationConnection(
        {
          workspaceId,
          provider: 'github',
          externalAccountId: '123',
          slug: 'github_123',
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
