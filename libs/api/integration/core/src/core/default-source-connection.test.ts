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

    const resolved = await resolveDefaultConnection({sourceConnection: source, registry});

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

    const resolved = await resolveDefaultConnection({sourceConnection: hidden, registry});

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
      resolveDefaultConnection({sourceConnection: hidden, registry}),
    ).resolves.toBeUndefined();
  });

  it('has no default when the source connection is gone', async () => {
    await expect(
      resolveDefaultConnection({sourceConnection: undefined, registry}),
    ).resolves.toBeUndefined();
  });
});
