import {
  createLeaseTokenAuthMethod,
  createRunnerSessionAuthMethod,
  verifyJobLeaseToken,
} from '@shipfox/api-auth';
import {AUTH_API_KEY, AUTH_USER} from '@shipfox/api-auth-context';
import {RUNNER_SESSION_TOKEN_AUDIENCE} from '@shipfox/api-auth-dto';
import type {AuthMethod} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {signHs256} from '@shipfox/node-jwt';
import {sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {db} from '#db/db.js';
import {createRunnerTokenAuthMethod} from '#presentation/auth/index.js';
import {pendingJobFactory, runnerTokenFactory} from '#test/index.js';
import {runnerRoutes} from './index.js';

const fakeApiKeyAuth: AuthMethod = {
  name: AUTH_API_KEY,
  authenticate: () => Promise.resolve(),
};

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: () => Promise.resolve(),
};

describe('POST /runners/jobs/request', () => {
  let app: FastifyInstance;
  let rawToken: string;
  let workspaceId: string;
  let sessionToken: string;
  let runnerSessionId: string;

  beforeAll(async () => {
    app = await createApp({
      auth: [
        fakeApiKeyAuth,
        fakeUserAuth,
        createRunnerTokenAuthMethod(),
        createRunnerSessionAuthMethod(),
        createLeaseTokenAuthMethod(),
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
      sql`TRUNCATE runners_pending_jobs, runners_running_jobs, runners_runner_sessions, runners_runner_tokens CASCADE`,
    );
    rawToken = `sf_r_${crypto.randomUUID()}`;
    workspaceId = crypto.randomUUID();
    await runnerTokenFactory.create({workspaceId}, {transient: {rawToken}});
    const registered = await registerSession(rawToken);
    sessionToken = registered.sessionToken;
    runnerSessionId = registered.runnerSessionId;
  });

  async function registerSession(
    token: string,
  ): Promise<{sessionToken: string; runnerSessionId: string}> {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${token}`},
      payload: {labels: ['Linux', 'x64']},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    return {sessionToken: body.session_token, runnerSessionId: body.session_id};
  }

  it('returns 401 without authorization', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with an invalid runner session token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: 'Bearer invalid'},
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with the job ids and a verifiable lease token when a job is available', async () => {
    const created = await pendingJobFactory.create({workspaceId});

    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${sessionToken}`},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.job_id).toBe(created.jobId);
    expect(body.run_id).toBe(created.runId);
    expect(typeof body.lease_token).toBe('string');
    expect(body.job_name).toBeUndefined();
    expect(body.steps).toBeUndefined();

    const claims = await verifyJobLeaseToken(body.lease_token);
    expect(claims).toMatchObject({
      jobId: created.jobId,
      runId: created.runId,
      projectId: created.projectId,
      workspaceId,
      runnerSessionId,
    });
  });

  it('returns 204 when no jobs are available for the session workspace', async () => {
    await pendingJobFactory.create({workspaceId: crypto.randomUUID()});

    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${sessionToken}`},
    });

    expect(res.statusCode).toBe(204);
  });

  it('claims multiple jobs from one manual session', async () => {
    const first = await pendingJobFactory.create({workspaceId});
    const second = await pendingJobFactory.create({workspaceId});

    const firstRes = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${sessionToken}`},
    });
    const secondRes = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${sessionToken}`},
    });

    expect(firstRes.statusCode).toBe(200);
    expect(firstRes.json().job_id).toBe(first.jobId);
    expect(secondRes.statusCode).toBe(200);
    expect(secondRes.json().job_id).toBe(second.jobId);
  });

  it('returns 401 when the runner session token is expired', async () => {
    const expiredSessionToken = await signHs256({
      payload: {
        runnerSessionId,
        workspaceId,
        scope: 'workspace',
        labels: ['linux', 'x64'],
      },
      secret: process.env.AUTH_RUNNER_SESSION_TOKEN_SECRET ?? 'test-runner-session-secret',
      expiresIn: '-1s',
      audience: RUNNER_SESSION_TOKEN_AUDIENCE,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${expiredSessionToken}`},
    });

    expect(res.statusCode).toBe(401);
  });
});
