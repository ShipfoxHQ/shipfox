import {closeApp, createApp} from '@shipfox/node-fastify';
import {eq} from 'drizzle-orm';
import {getSecret} from '#core/index.js';
import {db, secretValues, secretVariables} from '#db/index.js';
import {secretsE2eRoutes} from './index.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';

describe('secrets e2e routes', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let workspaceId: string;

  beforeEach(async () => {
    await closeApp();
    workspaceId = crypto.randomUUID();
    app = await createApp({routes: [secretsE2eRoutes], swagger: false});
    await app.ready();
  });

  afterEach(async () => {
    await db().delete(secretValues).where(eq(secretValues.workspaceId, workspaceId));
    await db().delete(secretVariables).where(eq(secretVariables.workspaceId, workspaceId));
    await closeApp();
  });

  it('creates a secret setup row without exposing plaintext', async () => {
    const value = 'seeded-secret-value';

    const res = await app.inject({
      method: 'POST',
      url: '/secrets/secret',
      payload: {
        workspace_id: workspaceId,
        actor_id: ACTOR_ID,
        key: 'API_TOKEN',
        value,
      },
    });
    const stored = await getSecret({workspaceId, key: 'API_TOKEN'});

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      key: 'API_TOKEN',
      project_id: null,
      last_edited_by: ACTOR_ID,
    });
    expect(stored).toBe(value);
    expect(res.body).not.toContain(value);
  });

  it('creates a variable setup row with its readable value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/secrets/variable',
      payload: {
        workspace_id: workspaceId,
        actor_id: ACTOR_ID,
        key: 'REGION',
        value: 'eu-west-1',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      key: 'REGION',
      project_id: null,
      value: 'eu-west-1',
      last_edited_by: ACTOR_ID,
    });
  });

  it('rejects invalid setup keys through route validation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/secrets/secret',
      payload: {
        workspace_id: workspaceId,
        actor_id: ACTOR_ID,
        key: 'bad-key',
        value: 'seeded-secret-value',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({code: 'validation-error'});
  });

  it('registers e2e setup routes without user auth', () => {
    const route = secretsE2eRoutes.routes[0];

    expect(secretsE2eRoutes.prefix).toBe('/secrets');
    expect(route?.auth).toBeUndefined();
  });
});
