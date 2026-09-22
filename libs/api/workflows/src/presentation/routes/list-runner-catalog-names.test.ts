import {AUTH_USER} from '@shipfox/api-auth-context';
import {type AuthMethod, closeApp, createApp} from '@shipfox/node-fastify';
import {createListRunnerCatalogNamesRoute} from './list-runner-catalog-names.js';

const userAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: () => Promise.resolve(),
};

afterEach(async () => {
  await closeApp();
});

describe('runner catalog names route', () => {
  it('returns names without exposing runner labels', async () => {
    const app = await createApp({
      auth: [userAuth],
      routes: [
        {
          prefix: '/workflows',
          auth: AUTH_USER,
          routes: [
            createListRunnerCatalogNamesRoute({
              hosted: ['linux', 'docker'],
              'self-hosted': ['self-hosted'],
            }),
          ],
        },
      ],
      swagger: false,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/workflows/runner-catalog',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({names: ['hosted', 'self-hosted']});
  });
});
