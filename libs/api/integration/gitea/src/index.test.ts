import {createGiteaIntegrationProvider, GiteaSourceControlProvider} from '#index.js';

describe('createGiteaIntegrationProvider', () => {
  it('exposes the gitea source-control adapter and the connection route group', () => {
    const provider = createGiteaIntegrationProvider({
      getExistingGiteaConnection: vi.fn(() => Promise.resolve(undefined)),
      connectGiteaConnection: vi.fn() as never,
    });

    expect(provider.provider).toBe('gitea');
    expect(provider.displayName).toBe('Gitea');
    expect(provider.adapters.source_control).toBeInstanceOf(GiteaSourceControlProvider);
    expect(provider.routes).toHaveLength(1);
    expect(provider.routes[0]?.prefix).toBe('/integrations/gitea');
  });
});
