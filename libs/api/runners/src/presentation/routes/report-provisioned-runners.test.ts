import {
  AUTH_LEASED_JOB,
  AUTH_PROVISIONER_TOKEN,
  AUTH_RUNNER_REGISTRATION_TOKEN,
  AUTH_RUNNER_SESSION,
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
import {provisionedRunners} from '#db/schema/provisioned-runners.js';
import {runnerRoutes} from './index.js';

const VALID_PROVISIONER_TOKEN = 'valid-provisioner-token';

const passthroughAuth = (name: string): AuthMethod => ({
  name,
  authenticate: () => Promise.resolve(),
});

describe('POST /provisioners/provisioned-runners/report', () => {
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
        passthroughAuth(AUTH_RUNNER_REGISTRATION_TOKEN),
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
    await db().execute(sql`TRUNCATE runners_provisioned_runners, runners_reservations CASCADE`);
    workspaceId = crypto.randomUUID();
    provisionerTokenId = crypto.randomUUID();
  });

  it('accepts provisioned runner lifecycle reports from provisioner auth', async () => {
    const reportedAt = '2025-01-01T00:00:00.000Z';

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/provisioned-runners/report',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        events: [
          {
            provisioned_runner_id: 'provisioned-runner-1',
            labels: ['linux'],
            state: 'starting',
            reported_at: reportedAt,
            provider_kind: 'docker',
          },
        ],
      },
    });

    const rows = await db().select().from(provisionedRunners);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({accepted: 1, reservations_released: 0});
    expect(rows[0]).toMatchObject({
      workspaceId,
      provisionerId: provisionerTokenId,
      provisionedRunnerId: 'provisioned-runner-1',
      state: 'starting',
      labels: ['linux'],
      providerKind: 'docker',
    });
    expect(rows[0]?.reportedAt.toISOString()).toBe(reportedAt);
  });

  it('returns 400 when the batch exceeds the DTO limit', async () => {
    const event = {
      provisioned_runner_id: 'provisioned-runner-1',
      labels: ['linux'],
      state: 'running',
      reported_at: new Date().toISOString(),
    };

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/provisioned-runners/report',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        events: Array.from({length: 1001}, (_, index) => ({
          ...event,
          provisioned_runner_id: `provisioned-runner-${index}`,
        })),
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for provider-sensitive extra fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/provisioned-runners/report',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: {
        events: [
          {
            provisioned_runner_id: 'provisioned-runner-1',
            labels: ['linux'],
            state: 'running',
            reported_at: new Date().toISOString(),
            hostname: 'worker-1',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without provisioner auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/provisioned-runners/report',
      payload: {
        events: [
          {
            provisioned_runner_id: 'provisioned-runner-1',
            labels: ['linux'],
            state: 'running',
            reported_at: new Date().toISOString(),
          },
        ],
      },
    });

    expect(res.statusCode).toBe(401);
  });
});
