import {verifyJobLeaseToken} from '@shipfox/api-auth';
import {AUTH_API_KEY, AUTH_USER} from '@shipfox/api-auth-context';
import type {AuthMethod} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {db} from '#db/db.js';
import {revokeRunnerToken} from '#db/runner-tokens.js';
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
  let runnerTokenId: string;

  beforeAll(async () => {
    app = await createApp({
      auth: [fakeApiKeyAuth, fakeUserAuth, createRunnerTokenAuthMethod()],
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
      sql`TRUNCATE runners_pending_jobs, runners_running_jobs, runners_runner_tokens CASCADE`,
    );
    rawToken = `sf_r_${crypto.randomUUID()}`;
    workspaceId = crypto.randomUUID();
    const token = await runnerTokenFactory.create({workspaceId}, {transient: {rawToken}});
    runnerTokenId = token.id;
  });

  it('returns 401 without authorization', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with an invalid runner token', async () => {
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
      headers: {authorization: `Bearer ${rawToken}`},
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
      runnerTokenId,
    });
  });

  it('returns 204 when no jobs are available for the token workspace', async () => {
    await pendingJobFactory.create({workspaceId: crypto.randomUUID()});

    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${rawToken}`},
    });

    expect(res.statusCode).toBe(204);
  });

  it('returns 401 when the runner token is expired', async () => {
    const expiredRawToken = `sf_r_${crypto.randomUUID()}`;
    await runnerTokenFactory.create(
      {workspaceId, expiresAt: new Date(Date.now() - 1000)},
      {transient: {rawToken: expiredRawToken}},
    );

    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${expiredRawToken}`},
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when the runner token is revoked', async () => {
    const revokedRawToken = `sf_r_${crypto.randomUUID()}`;
    const token = await runnerTokenFactory.create(
      {workspaceId},
      {transient: {rawToken: revokedRawToken}},
    );
    await revokeRunnerToken({tokenId: token.id, workspaceId});

    const res = await app.inject({
      method: 'POST',
      url: '/runners/jobs/request',
      headers: {authorization: `Bearer ${revokedRawToken}`},
    });

    expect(res.statusCode).toBe(401);
  });
});
