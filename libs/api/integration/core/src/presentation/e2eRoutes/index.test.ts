import {randomUUID} from 'node:crypto';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {db} from '#db/db.js';
import {integrationsOutbox} from '#db/schema/outbox.js';
import {createIntegrationE2eRoutes} from './index.js';

const UUID_RE = /^[0-9a-f-]{36}$/u;

async function createTestApp(): Promise<FastifyInstance> {
  const routes = createIntegrationE2eRoutes([]);
  const app = await createApp({routes: [routes], swagger: false});
  await app.ready();
  return app;
}

async function truncateState(): Promise<void> {
  await db().execute(sql`TRUNCATE integrations_connections CASCADE`);
  await db().execute(sql`TRUNCATE integrations_outbox CASCADE`);
}

describe('integration E2E routes', () => {
  beforeEach(async () => {
    await closeApp();
    await truncateState();
  });

  afterEach(async () => {
    await closeApp();
  });

  describe('POST /integration/connections', () => {
    it('seeds an active integration connection', async () => {
      const app = await createTestApp();
      const workspaceId = randomUUID();

      const res = await app.inject({
        method: 'POST',
        url: '/integration/connections',
        payload: {
          workspace_id: workspaceId,
          provider: 'github',
          external_account_id: 'installation-42',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.connection).toMatchObject({
        workspace_id: workspaceId,
        provider: 'github',
        external_account_id: 'installation-42',
        display_name: 'e2e-installation-42',
        lifecycle_status: 'active',
      });
      expect(body.connection.id).toMatch(UUID_RE);
    });

    it('honors lifecycle_status and display_name overrides', async () => {
      const app = await createTestApp();

      const res = await app.inject({
        method: 'POST',
        url: '/integration/connections',
        payload: {
          workspace_id: randomUUID(),
          provider: 'github',
          external_account_id: 'installation-99',
          display_name: 'Custom name',
          lifecycle_status: 'disabled',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().connection).toMatchObject({
        display_name: 'Custom name',
        lifecycle_status: 'disabled',
      });
    });

    it('rejects a missing body field with 400', async () => {
      const app = await createTestApp();

      const res = await app.inject({
        method: 'POST',
        url: '/integration/connections',
        payload: {workspace_id: randomUUID(), provider: 'github'},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /integration/events', () => {
    it('returns rows filtered by deliveryId', async () => {
      const app = await createTestApp();
      const deliveryId = randomUUID();
      await db()
        .insert(integrationsOutbox)
        .values([
          {
            eventType: 'integrations.repository.pushed',
            payload: {deliveryId, headCommitSha: 'abc'},
          },
          {
            eventType: 'integrations.repository.pushed',
            payload: {deliveryId: randomUUID(), headCommitSha: 'other'},
          },
        ]);

      const res = await app.inject({
        method: 'GET',
        url: `/integration/events?delivery_id=${deliveryId}`,
      });

      expect(res.statusCode).toBe(200);
      const events = res.json().events;
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event_type: 'integrations.repository.pushed',
        payload: {deliveryId, headCommitSha: 'abc'},
      });
    });

    it('filters by event_type', async () => {
      const app = await createTestApp();
      await db()
        .insert(integrationsOutbox)
        .values([
          {eventType: 'integrations.repository.pushed', payload: {deliveryId: 'a'}},
          {eventType: 'integrations.other', payload: {deliveryId: 'b'}},
        ]);

      const res = await app.inject({
        method: 'GET',
        url: '/integration/events?event_type=integrations.repository.pushed',
      });

      expect(res.statusCode).toBe(200);
      const events = res.json().events;
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('integrations.repository.pushed');
    });

    it('returns an empty list (not 404) when nothing matches', async () => {
      const app = await createTestApp();

      const res = await app.inject({
        method: 'GET',
        url: `/integration/events?delivery_id=${randomUUID()}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().events).toEqual([]);
    });
  });
});
