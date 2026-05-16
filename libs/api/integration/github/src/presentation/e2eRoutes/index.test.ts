import {closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import {insertConnection, truncateIntegrationsState} from '#test/core-fixtures.js';
import {githubE2eRoutes} from './index.js';

async function createTestApp(): Promise<FastifyInstance> {
  const app = await createApp({routes: [githubE2eRoutes], swagger: false});
  await app.ready();
  return app;
}

describe('GitHub E2E routes', () => {
  beforeEach(async () => {
    await closeApp();
    await truncateIntegrationsState();
  });

  afterEach(async () => {
    await closeApp();
  });

  describe('POST /github/installations', () => {
    it('seeds an installation tied to a connection', async () => {
      const app = await createTestApp();
      const connection = await insertConnection({externalAccountId: '424242'});

      const res = await app.inject({
        method: 'POST',
        url: '/github/installations',
        payload: {
          connection_id: connection.id,
          installation_id: '424242',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().installation).toMatchObject({
        connection_id: connection.id,
        installation_id: '424242',
      });
    });

    it('honors optional account fields', async () => {
      const app = await createTestApp();
      const connection = await insertConnection({externalAccountId: '111'});

      const res = await app.inject({
        method: 'POST',
        url: '/github/installations',
        payload: {
          connection_id: connection.id,
          installation_id: '111',
          account_login: 'shipfox',
          account_type: 'User',
          repository_selection: 'selected',
        },
      });

      expect(res.statusCode).toBe(201);
    });

    it('rejects a missing installation_id with 400', async () => {
      const app = await createTestApp();

      const res = await app.inject({
        method: 'POST',
        url: '/github/installations',
        payload: {connection_id: '00000000-0000-0000-0000-000000000000'},
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
