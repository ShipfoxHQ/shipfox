import {giteaProviderModule} from '#providers/gitea.js';
import {createTestApp, sourceProvider, useIntegrationRouteTest} from '#test/route-utils.js';

describe('GET /integration-providers', () => {
  useIntegrationRouteTest();

  it('requires user auth', async () => {
    const app = await createTestApp([sourceProvider()]);

    const res = await app.inject({
      method: 'GET',
      url: '/integration-providers',
    });

    expect(res.statusCode).toBe(401);
  });

  it('lists providers by capability', async () => {
    const app = await createTestApp([
      sourceProvider(),
      {
        provider: 'github',
        displayName: 'GitHub',
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/integration-providers?capability=source_control',
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().providers.map((provider: {provider: string}) => provider.provider)).toEqual([
      'gitea',
    ]);
  });

  it('surfaces the gitea provider once its module is registered', async () => {
    const {provider} = await giteaProviderModule.load();
    const app = await createTestApp([provider]);

    const res = await app.inject({
      method: 'GET',
      url: '/integration-providers',
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().providers.map((entry: {provider: string}) => entry.provider)).toContain(
      'gitea',
    );
  });
});
