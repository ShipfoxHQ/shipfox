import {createApp} from '@shipfox/node-fastify';
import type {LoginMethod} from '@shipfox/node-module';
import {createLoginMethodsRoute} from './login-methods.js';

describe('createLoginMethodsRoute', () => {
  it('lists registered methods exactly once, including unknown future IDs', async () => {
    const app = await createApp({
      auth: [],
      routes: [
        createLoginMethodsRoute({
          loginMethods: [{id: 'password'}, {id: 'oauth-google'}, {id: 'future-provider'}],
        }),
      ],
      swagger: false,
    });

    try {
      const response = await app.inject({method: 'GET', url: '/auth/login-methods'});

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        login_methods: [{id: 'password'}, {id: 'oauth-google'}, {id: 'future-provider'}],
      });
    } finally {
      await app.close();
    }
  });

  it('does not serialize module implementation details', async () => {
    const loginMethod = {
      id: 'oauth-google',
      clientSecret: 'not-for-clients',
      callbackUrl: 'https://api.example.test/auth/callback',
    } as LoginMethod;
    const app = await createApp({
      auth: [],
      routes: [createLoginMethodsRoute({loginMethods: [loginMethod]})],
      swagger: false,
    });

    try {
      const response = await app.inject({method: 'GET', url: '/auth/login-methods'});

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({login_methods: [{id: 'oauth-google'}]});
      expect(response.body).not.toContain('not-for-clients');
      expect(response.body).not.toContain('api.example.test');
    } finally {
      await app.close();
    }
  });

  it('rejects an out-of-contract login method ID before the server can start', () => {
    expect(() => createLoginMethodsRoute({loginMethods: [{id: ''}]})).toThrow();
  });
});
