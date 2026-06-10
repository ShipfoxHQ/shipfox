import {AUTH_API_KEY, AUTH_USER} from '@shipfox/api-auth-context';
import type {AuthMethod} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {db} from '#db/db.js';
import {claimPendingJob, requestJobCancellation} from '#db/jobs.js';
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

describe('POST /runners/jobs/:jobId/heartbeat', () => {
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
      sql`TRUNCATE runners_pending_jobs, runners_running_jobs, runners_runner_tokens, runners_outbox CASCADE`,
    );
    rawToken = `sf_r_${crypto.randomUUID()}`;
    workspaceId = crypto.randomUUID();
    const token = await runnerTokenFactory.create({workspaceId}, {transient: {rawToken}});
    runnerTokenId = token.id;
  });

  it('returns 401 without authorization', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${crypto.randomUUID()}/heartbeat`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 200 + cancel:false on a fresh row', async () => {
    const pending = await pendingJobFactory.create({workspaceId});
    await claimPendingJob({workspaceId, runnerTokenId});

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${pending.jobId}/heartbeat`,
      headers: {authorization: `Bearer ${rawToken}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({cancel: false});
  });

  it('returns 200 + cancel:true after requestJobCancellation', async () => {
    const pending = await pendingJobFactory.create({workspaceId});
    await claimPendingJob({workspaceId, runnerTokenId});
    await requestJobCancellation({jobId: pending.jobId});

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${pending.jobId}/heartbeat`,
      headers: {authorization: `Bearer ${rawToken}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({cancel: true});
  });

  it('returns 404 when the jobId is unknown', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${crypto.randomUUID()}/heartbeat`,
      headers: {authorization: `Bearer ${rawToken}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('running-job-not-found');
  });

  it('returns 404 when the job belongs to a different runner token', async () => {
    const pending = await pendingJobFactory.create({workspaceId});
    const otherRawToken = `sf_r_${crypto.randomUUID()}`;
    await runnerTokenFactory.create({workspaceId}, {transient: {rawToken: otherRawToken}});
    await claimPendingJob({workspaceId, runnerTokenId});

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${pending.jobId}/heartbeat`,
      headers: {authorization: `Bearer ${otherRawToken}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('running-job-not-found');
  });
});
