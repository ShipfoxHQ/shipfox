import {createLeaseTokenAuthMethod} from '@shipfox/api-auth';
import {
  AUTH_LEASED_JOB,
  AUTH_USER,
  buildUserContext,
  setUserContext,
} from '@shipfox/api-auth-context';
import {type AuthMethod, ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import {runnersTestClient} from '#test/fixtures/runners-inter-module.js';
import {createWorkflowRoutes} from './index.js';

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }

    setUserContext(
      request,
      buildUserContext({userId: 'user-1', email: 'user@example.com', memberships: []}),
    );
    return Promise.resolve();
  },
};

afterEach(async () => {
  await closeApp();
});

describe('workflow route auth', () => {
  const workflowRoutes = createWorkflowRoutes(runnersTestClient);
  test('uses user auth', () => {
    expect(workflowRoutes[0]?.auth).toBe(AUTH_USER);
  });

  test('rejects API-key-only requests', async () => {
    const app = await createApp({
      auth: [fakeUserAuth, createLeaseTokenAuthMethod()],
      routes: workflowRoutes,
      swagger: false,
    });
    const res = await app.inject({
      method: 'GET',
      url: `/workflows/runs?project_id=${crypto.randomUUID()}`,
      headers: {authorization: 'Bearer api-key'},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
  });

  test('step routes use lease-token auth', () => {
    expect(workflowRoutes[1]?.prefix).toBe('/runs/jobs/current');
    expect(workflowRoutes[1]?.auth).toBe(AUTH_LEASED_JOB);
  });

  test('step routes reject requests without a lease token', async () => {
    const app = await createApp({
      auth: [fakeUserAuth, createLeaseTokenAuthMethod()],
      routes: workflowRoutes,
      swagger: false,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/runs/jobs/current/steps/next',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
  });
});
