import {
  AUTH_LEASED_JOB,
  AUTH_PROVISIONER_TOKEN,
  AUTH_RUNNER_SESSION,
  AUTH_RUNNER_TOKEN,
  AUTH_USER,
  setProvisionerContext,
} from '@shipfox/api-auth-context';
import {
  type AuthMethod,
  ClientError,
  closeApp,
  createApp,
  extractBearerToken,
} from '@shipfox/node-fastify';
import {sql} from 'drizzle-orm';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {db} from '#db/db.js';
import {pendingJobFactory} from '#test/index.js';
import {runnerRoutes} from './index.js';

const VALID_PROVISIONER_TOKEN = 'valid-provisioner-token';

const passthroughAuth = (name: string): AuthMethod => ({
  name,
  authenticate: () => Promise.resolve(),
});

describe('POST /provisioners/demand/poll', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let provisionerTokenId: string;

  const fakeProvisionerAuth: AuthMethod = {
    name: AUTH_PROVISIONER_TOKEN,
    authenticate: (request: FastifyRequest) => {
      const rawToken = extractBearerToken(request.headers.authorization);
      if (rawToken !== VALID_PROVISIONER_TOKEN) {
        throw new ClientError('Invalid provisioner token', 'unauthorized', {status: 401});
      }
      setProvisionerContext(request, {workspaceId, provisionerTokenId});
      return Promise.resolve();
    },
  };

  beforeAll(async () => {
    app = await createApp({
      auth: [
        passthroughAuth(AUTH_USER),
        passthroughAuth(AUTH_RUNNER_TOKEN),
        passthroughAuth(AUTH_RUNNER_SESSION),
        passthroughAuth(AUTH_LEASED_JOB),
        fakeProvisionerAuth,
      ],
      routes: runnerRoutes,
      swagger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_pending_jobs, runners_reservations, runners_outbox CASCADE`,
    );
    workspaceId = crypto.randomUUID();
    provisionerTokenId = crypto.randomUUID();
  });

  it('returns demand stats and reservations when matching demand exists', async () => {
    await pendingJobFactory.create({workspaceId, requiredLabels: ['linux']});

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/demand/poll',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body({max_reservations: 1}),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      stats: [{labels: ['linux'], queued: 1, reserved: 1}],
      reservations: [{labels: ['linux'], count: 1}],
    });
    expect(res.json().reservations[0].reservation_id).toEqual(expect.any(String));
    expect(res.json().reservations[0].expires_at).toEqual(expect.any(String));
  });

  it('returns stats without reservations in observe-only mode', async () => {
    await pendingJobFactory.create({workspaceId, requiredLabels: ['linux']});

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/demand/poll',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body({max_reservations: 0}),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      stats: [{labels: ['linux'], queued: 1, reserved: 0}],
      reservations: [],
    });
  });

  it('returns 400 for max reservations above the request bound', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/demand/poll',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body({max_reservations: 1001}),
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for too many templates', async () => {
    const templates = Array.from({length: 101}, (_, index) => ({
      template_key: `linux-${index}`,
      labels: ['linux'],
      available_slots: 1,
      starting: 0,
      running: 0,
    }));

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/demand/poll',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {wait_seconds: 0, max_reservations: 1, templates},
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without authorization', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/demand/poll',
      payload: body({max_reservations: 1}),
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with invalid authorization', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/demand/poll',
      headers: {authorization: 'Bearer invalid'},
      payload: body({max_reservations: 1}),
    });

    expect(res.statusCode).toBe(401);
  });

  function body(params: {max_reservations: number}) {
    return {
      wait_seconds: 0,
      max_reservations: params.max_reservations,
      templates: [
        {
          template_key: 'linux',
          labels: ['linux'],
          available_slots: 1,
          starting: 0,
          running: 0,
        },
      ],
    };
  }
});
