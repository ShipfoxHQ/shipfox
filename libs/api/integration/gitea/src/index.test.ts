import {createGiteaIntegrationProvider} from '#index.js';

describe('createGiteaIntegrationProvider', () => {
  it('returns the empty gitea provider scaffold', () => {
    const provider = createGiteaIntegrationProvider();

    expect(provider).toEqual({
      provider: 'gitea',
      displayName: 'Gitea',
      adapters: {},
      routes: [],
    });
  });
});
