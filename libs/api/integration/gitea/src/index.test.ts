import {createGiteaIntegrationProvider, GiteaSourceControlProvider} from '#index.js';

describe('createGiteaIntegrationProvider', () => {
  it('exposes the gitea source-control adapter', () => {
    const provider = createGiteaIntegrationProvider();

    expect(provider.provider).toBe('gitea');
    expect(provider.displayName).toBe('Gitea');
    expect(provider.routes).toEqual([]);
    expect(provider.adapters.source_control).toBeInstanceOf(GiteaSourceControlProvider);
  });
});
