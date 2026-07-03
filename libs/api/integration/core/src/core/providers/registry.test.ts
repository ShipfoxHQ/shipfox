import {
  IntegrationCapabilityUnavailableError,
  IntegrationProviderUnavailableError,
} from '#core/errors.js';
import {createIntegrationProviderRegistry} from './registry.js';

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
  };
}

describe('integration provider registry', () => {
  it('lists providers by capability', () => {
    const registry = createIntegrationProviderRegistry([
      {
        provider: 'gitea',
        displayName: 'Gitea',
        adapters: {
          source_control: sourceControlAdapter(),
        },
      },
      {
        provider: 'github',
        displayName: 'GitHub',
      },
    ]);

    const result = registry.list('source_control');

    expect(result.map((provider) => provider.provider)).toEqual(['gitea']);
  });

  it('keeps provider sets isolated per registry instance', () => {
    const emptyRegistry = createIntegrationProviderRegistry([]);
    const giteaRegistry = createIntegrationProviderRegistry([
      {
        provider: 'gitea',
        displayName: 'Gitea',
        adapters: {
          source_control: sourceControlAdapter(),
        },
      },
    ]);

    expect(giteaRegistry.get('gitea').provider).toBe('gitea');
    expect(() => emptyRegistry.get('gitea')).toThrow(IntegrationProviderUnavailableError);
  });

  it('rejects source-control access for providers without the capability implementation', () => {
    const registry = createIntegrationProviderRegistry([
      {
        provider: 'gitea',
        displayName: 'Gitea',
      },
    ]);

    const result = () => registry.getSourceControl('gitea');

    expect(result).toThrow(IntegrationCapabilityUnavailableError);
  });

  it('rejects duplicate provider registrations', () => {
    const result = () =>
      createIntegrationProviderRegistry([
        {
          provider: 'gitea',
          displayName: 'Gitea',
        },
        {
          provider: 'gitea',
          displayName: 'Gitea Duplicate',
        },
      ]);

    expect(result).toThrow('Duplicate integration provider registered');
  });

  it('rejects invalid provider ids', () => {
    const result = () =>
      createIntegrationProviderRegistry([
        {
          provider: 'GitHub',
          displayName: 'GitHub',
        },
      ]);

    expect(result).toThrow('Invalid integration provider id');
  });
});
