import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import {createIntegrationProviderRegistry} from '#core/providers/registry.js';
import {createSourceControlIntegrationService} from '#core/source-control-service.js';
import {getIntegrationConnectionById, upsertIntegrationConnection} from '#db/connections.js';
import {sourceProvider} from '#test/route-utils.js';
import {createIntegrationsInterModulePresentation} from './inter-module.js';

const platform = {
  kind: 'repository',
  externalId: 'gitea:gitea-owner/platform',
  lookupName: 'gitea-owner/platform',
  displayName: 'gitea-owner/Platform',
};

function createClient(providers: Parameters<typeof createIntegrationProviderRegistry>[0]) {
  const registry = createIntegrationProviderRegistry(providers);
  const transport = createInMemoryInterModuleTransport();
  const client = transport.createClient(integrationsInterModuleContract);
  transport.register(
    createIntegrationsInterModulePresentation({
      registry,
      sourceControl: createSourceControlIntegrationService({
        registry,
        getIntegrationConnectionById,
      }),
    }),
  );
  transport.seal();
  return client;
}

function scopeProvider(overrides: Parameters<typeof sourceProvider>[0] = {}) {
  return sourceProvider({
    resourceKinds: [{kind: 'repository', label: 'Repositories'}],
    listScopeResources: vi.fn(() => Promise.resolve({resources: [platform], nextCursor: null})),
    resolveScopeResource: vi.fn(({externalId}) =>
      Promise.resolve(externalId === platform.externalId ? platform : null),
    ),
    ...overrides,
  });
}

async function createConnection(
  workspaceId: string,
  overrides: Partial<Parameters<typeof upsertIntegrationConnection>[0]> = {},
) {
  return await upsertIntegrationConnection({
    workspaceId,
    provider: 'gitea',
    externalAccountId: `gitea-owner-${crypto.randomUUID()}`,
    slug: `gitea_${crypto.randomUUID().slice(0, 8)}`,
    displayName: 'Gitea',
    capabilities: ['source_control'],
    ...overrides,
  });
}

describe('integrations scope inter-module presentation', () => {
  describe('getScopeConnection', () => {
    it('describes a connection with the resource kinds of its provider', async () => {
      const workspaceId = crypto.randomUUID();
      const connection = await createConnection(workspaceId);
      const client = createClient([scopeProvider()]);

      await expect(
        client.getScopeConnection({workspaceId, connectionId: connection.id}),
      ).resolves.toEqual({
        id: connection.id,
        provider: 'gitea',
        slug: connection.slug,
        displayName: 'Gitea',
        lifecycleStatus: 'active',
        internal: false,
        resourceKinds: [{kind: 'repository', label: 'Repositories'}],
      });
    });

    it('has no resource kind for a provider that declares none', async () => {
      const workspaceId = crypto.randomUUID();
      const connection = await createConnection(workspaceId);
      const client = createClient([sourceProvider()]);

      const result = await client.getScopeConnection({workspaceId, connectionId: connection.id});

      expect(result?.resourceKinds).toEqual([]);
    });

    it('marks the connection of an internal provider', async () => {
      const workspaceId = crypto.randomUUID();
      const connection = await createConnection(workspaceId);
      const client = createClient([scopeProvider({internal: true})]);

      const result = await client.getScopeConnection({workspaceId, connectionId: connection.id});

      expect(result?.internal).toBe(true);
    });

    it('answers null when the provider of the connection is not registered', async () => {
      const workspaceId = crypto.randomUUID();
      const connection = await createConnection(workspaceId);
      const client = createClient([]);

      await expect(
        client.getScopeConnection({workspaceId, connectionId: connection.id}),
      ).resolves.toBeNull();
    });

    it('answers null for a missing connection and for one of another workspace', async () => {
      const connection = await createConnection(crypto.randomUUID());
      const client = createClient([scopeProvider()]);

      await expect(
        client.getScopeConnection({
          workspaceId: crypto.randomUUID(),
          connectionId: connection.id,
        }),
      ).resolves.toBeNull();
      await expect(
        client.getScopeConnection({
          workspaceId: connection.workspaceId,
          connectionId: crypto.randomUUID(),
        }),
      ).resolves.toBeNull();
    });
  });

  describe('resolveScopeResource', () => {
    it('resolves a resource through the provider', async () => {
      const workspaceId = crypto.randomUUID();
      const connection = await createConnection(workspaceId);
      const provider = scopeProvider();
      const client = createClient([provider]);

      const result = await client.resolveScopeResource({
        workspaceId,
        connectionId: connection.id,
        kind: 'repository',
        externalId: platform.externalId,
      });

      expect(result).toEqual(platform);
      expect(provider.resolveScopeResource).toHaveBeenCalledWith({
        connection: expect.objectContaining({id: connection.id}),
        kind: 'repository',
        externalId: platform.externalId,
      });
    });

    it('answers null for a resource the connection cannot see', async () => {
      const workspaceId = crypto.randomUUID();
      const connection = await createConnection(workspaceId);
      const client = createClient([scopeProvider()]);

      await expect(
        client.resolveScopeResource({
          workspaceId,
          connectionId: connection.id,
          kind: 'repository',
          externalId: 'gitea:other/missing',
        }),
      ).resolves.toBeNull();
    });

    it('refuses a kind the provider does not declare', async () => {
      const workspaceId = crypto.randomUUID();
      const connection = await createConnection(workspaceId);
      const client = createClient([scopeProvider()]);

      const error = await client
        .resolveScopeResource({
          workspaceId,
          connectionId: connection.id,
          kind: 'team',
          externalId: 'team-1',
        })
        .catch((caught) => caught);

      expect(
        isInterModuleKnownError(
          integrationsInterModuleContract.methods.resolveScopeResource,
          error,
        ),
      ).toBe(true);
      expect(error.code).toBe('resource-kind-unsupported');
    });

    it.each([
      ['a connection of another workspace', 'connection-workspace-mismatch'],
      ['an inactive connection', 'connection-inactive'],
      ['a missing connection', 'connection-not-found'],
    ])('refuses %s', async (scenario, code) => {
      const workspaceId = crypto.randomUUID();
      const connection = await createConnection(
        scenario === 'a connection of another workspace' ? crypto.randomUUID() : workspaceId,
        scenario === 'an inactive connection' ? {lifecycleStatus: 'disabled'} : {},
      );
      const client = createClient([scopeProvider()]);

      const error = await client
        .resolveScopeResource({
          workspaceId,
          connectionId: scenario === 'a missing connection' ? crypto.randomUUID() : connection.id,
          kind: 'repository',
          externalId: platform.externalId,
        })
        .catch((caught) => caught);

      expect(error.code).toBe(code);
    });
  });
});
