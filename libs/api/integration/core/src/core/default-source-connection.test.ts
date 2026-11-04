import type {ProjectAccessPolicy} from '@shipfox/api-projects-dto';
import {createIntegrationProviderRegistry} from '#core/providers/registry.js';
import {integrationConnectionFactory} from '#test/factories/connection.js';
import {
  findSoleSourceControlConnection,
  resolveDefaultConnection,
} from './default-source-connection.js';

function sourceControlAdapter() {
  return {
    listRepositories: async () => {
      await Promise.resolve();
      return {repositories: [], nextCursor: null};
    },
    resolveRepository: async () => {
      await Promise.resolve();
      throw new Error('not used');
    },
    listFiles: async () => {
      await Promise.resolve();
      return {files: [], nextCursor: null};
    },
    fetchFile: async () => {
      await Promise.resolve();
      throw new Error('not used');
    },
    resolveTriggerReference: () => null,
    resolveRef: async () => {
      await Promise.resolve();
      throw new Error('not used');
    },
  };
}

const registry = createIntegrationProviderRegistry([
  {
    provider: 'github',
    displayName: 'GitHub',
    adapters: {source_control: sourceControlAdapter()},
  },
  {
    provider: 'gitea',
    displayName: 'Gitea',
    adapters: {source_control: sourceControlAdapter()},
  },
  {
    provider: 'managed-vcs',
    displayName: 'Shipfox',
    internal: true,
    adapters: {source_control: sourceControlAdapter()},
  },
  {provider: 'webhook', displayName: 'Webhook'},
]);

describe('findSoleSourceControlConnection', () => {
  it('returns the only source-control connection, ignoring the hidden managed one', async () => {
    const workspaceId = crypto.randomUUID();
    await integrationConnectionFactory.create({
      workspaceId,
      provider: 'managed-vcs',
      externalAccountId: workspaceId,
      slug: 'shipfox-managed',
    });
    await integrationConnectionFactory.create({
      workspaceId,
      provider: 'webhook',
      externalAccountId: 'hook',
      slug: 'webhook',
    });
    const github = await integrationConnectionFactory.create({
      workspaceId,
      provider: 'github',
      externalAccountId: 'acme',
      slug: 'github',
    });

    const sole = await findSoleSourceControlConnection({workspaceId, registry});

    expect(sole?.id).toBe(github.id);
  });

  it('returns nothing when the workspace has none', async () => {
    const workspaceId = crypto.randomUUID();
    await integrationConnectionFactory.create({
      workspaceId,
      provider: 'managed-vcs',
      externalAccountId: workspaceId,
      slug: 'shipfox-managed',
    });

    await expect(findSoleSourceControlConnection({workspaceId, registry})).resolves.toBeUndefined();
  });

  it('returns nothing when the workspace has several', async () => {
    const workspaceId = crypto.randomUUID();
    await integrationConnectionFactory.create({
      workspaceId,
      provider: 'github',
      externalAccountId: 'acme',
      slug: 'github',
    });
    await integrationConnectionFactory.create({
      workspaceId,
      provider: 'gitea',
      externalAccountId: 'acme',
      slug: 'gitea',
    });

    await expect(findSoleSourceControlConnection({workspaceId, registry})).resolves.toBeUndefined();
  });

  it('does not count a disabled connection', async () => {
    const workspaceId = crypto.randomUUID();
    const github = await integrationConnectionFactory.create({
      workspaceId,
      provider: 'github',
      externalAccountId: 'acme',
      slug: 'github',
    });
    await integrationConnectionFactory.create({
      workspaceId,
      provider: 'gitea',
      externalAccountId: 'acme',
      slug: 'gitea',
      lifecycleStatus: 'disabled',
    });

    const sole = await findSoleSourceControlConnection({workspaceId, registry});

    expect(sole?.id).toBe(github.id);
  });
});

function managedPolicy(connections: ProjectAccessPolicy['connections']): ProjectAccessPolicy {
  return {
    projectId: crypto.randomUUID(),
    configSource: {
      managed: true,
      connectionId: crypto.randomUUID(),
      externalRepositoryId: 'managed:project',
      lookupName: null,
    },
    connections,
  };
}

describe('resolveDefaultConnection', () => {
  it("uses a linked project's source connection even when the workspace has several", async () => {
    const workspaceId = crypto.randomUUID();
    const source = await integrationConnectionFactory.create({
      workspaceId,
      provider: 'github',
      externalAccountId: 'acme',
      slug: 'github',
    });
    await integrationConnectionFactory.create({
      workspaceId,
      provider: 'gitea',
      externalAccountId: 'acme',
      slug: 'gitea',
    });

    const resolved = await resolveDefaultConnection({
      sourceConnection: source,
      loadPolicy: async () => managedPolicy('all'),
      registry,
    });

    expect(resolved?.id).toBe(source.id);
  });

  it("uses the workspace's only source-control connection for a managed project", async () => {
    const workspaceId = crypto.randomUUID();
    const hidden = await integrationConnectionFactory.create({
      workspaceId,
      provider: 'managed-vcs',
      externalAccountId: workspaceId,
      slug: 'shipfox-managed',
    });
    const github = await integrationConnectionFactory.create({
      workspaceId,
      provider: 'github',
      externalAccountId: 'acme',
      slug: 'github',
    });

    const resolved = await resolveDefaultConnection({
      sourceConnection: hidden,
      loadPolicy: async () => managedPolicy('all'),
      registry,
    });

    expect(resolved?.id).toBe(github.id);
  });

  it('has no default for a managed project when the workspace has several', async () => {
    const workspaceId = crypto.randomUUID();
    const hidden = await integrationConnectionFactory.create({
      workspaceId,
      provider: 'managed-vcs',
      externalAccountId: workspaceId,
      slug: 'shipfox-managed',
    });
    await integrationConnectionFactory.create({
      workspaceId,
      provider: 'github',
      externalAccountId: 'acme',
      slug: 'github',
    });
    await integrationConnectionFactory.create({
      workspaceId,
      provider: 'gitea',
      externalAccountId: 'acme',
      slug: 'gitea',
    });

    await expect(
      resolveDefaultConnection({
        sourceConnection: hidden,
        loadPolicy: async () => managedPolicy('all'),
        registry,
      }),
    ).resolves.toBeUndefined();
  });

  it('uses the one source-control connection the managed project lists, among several', async () => {
    const workspaceId = crypto.randomUUID();
    const hidden = await integrationConnectionFactory.create({
      workspaceId,
      provider: 'managed-vcs',
      externalAccountId: workspaceId,
      slug: 'shipfox-managed',
    });
    await integrationConnectionFactory.create({
      workspaceId,
      provider: 'github',
      externalAccountId: 'acme',
      slug: 'github',
    });
    const gitea = await integrationConnectionFactory.create({
      workspaceId,
      provider: 'gitea',
      externalAccountId: 'acme',
      slug: 'gitea',
    });

    const resolved = await resolveDefaultConnection({
      sourceConnection: hidden,
      loadPolicy: async () => managedPolicy([{connectionId: gitea.id, resources: 'all'}]),
      registry,
    });

    expect(resolved?.id).toBe(gitea.id);
  });

  it('does not fall back to the workspace sole connection when the project lists a list', async () => {
    const workspaceId = crypto.randomUUID();
    const hidden = await integrationConnectionFactory.create({
      workspaceId,
      provider: 'managed-vcs',
      externalAccountId: workspaceId,
      slug: 'shipfox-managed',
    });
    await integrationConnectionFactory.create({
      workspaceId,
      provider: 'github',
      externalAccountId: 'acme',
      slug: 'github',
    });

    await expect(
      resolveDefaultConnection({
        sourceConnection: hidden,
        loadPolicy: async () => managedPolicy([]),
        registry,
      }),
    ).resolves.toBeUndefined();
  });

  it('has no default when the source connection is gone', async () => {
    await expect(
      resolveDefaultConnection({
        sourceConnection: undefined,
        loadPolicy: async () => managedPolicy('all'),
        registry,
      }),
    ).resolves.toBeUndefined();
  });
});
