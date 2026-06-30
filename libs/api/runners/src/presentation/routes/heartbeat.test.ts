import {
  createLeaseTokenAuthMethod,
  createRunnerSessionAuthMethod,
  issueJobLeaseToken,
  verifyJobLeaseToken,
} from '@shipfox/api-auth';
import {AUTH_PROVISIONER_TOKEN, AUTH_USER} from '@shipfox/api-auth-context';
import type {AuthMethod} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {claimJob} from '#core/jobs.js';
import {db} from '#db/db.js';
import {requestJobCancellation} from '#db/jobs.js';
import {createRunnerTokenAuthMethod} from '#presentation/auth/index.js';
import {pendingJobFactory, runnerSessionFactory} from '#test/index.js';
import {runnerRoutes} from './index.js';

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: () => Promise.resolve(),
};

const fakeProvisionerAuth: AuthMethod = {
  name: AUTH_PROVISIONER_TOKEN,
  authenticate: () => Promise.resolve(),
};

describe('POST /runners/jobs/:jobId/heartbeat', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let runnerSessionId: string;

  beforeAll(async () => {
    app = await createApp({
      auth: [
        fakeUserAuth,
        createRunnerTokenAuthMethod(),
        createRunnerSessionAuthMethod(),
        createLeaseTokenAuthMethod(),
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
      sql`TRUNCATE runners_ephemeral_registration_tokens, runners_pending_jobs, runners_running_jobs, runners_runner_sessions, runners_runner_tokens, runners_outbox CASCADE`,
    );
    workspaceId = crypto.randomUUID();
    const session = await runnerSessionFactory.create({workspaceId});
    runnerSessionId = session.id;
  });

  async function claimAvailableJob(): Promise<{
    jobId: string;
    executionId: string;
    leaseToken: string;
  }> {
    const pending = await pendingJobFactory.create({workspaceId});
    const claimed = await claimJob({
      workspaceId,
      runnerSessionId,
      sessionLabels: ['linux', 'x64'],
      maxClaims: null,
    });
    expect(claimed).not.toBeNull();
    return {
      jobId: pending.jobId,
      executionId: claimed?.executionId as string,
      leaseToken: claimed?.leaseToken as string,
    };
  }

  it('returns 401 without authorization', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${crypto.randomUUID()}/heartbeat`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 200 + cancel:false on a fresh row', async () => {
    const {jobId, executionId, leaseToken} = await claimAvailableJob();

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${jobId}/heartbeat`,
      headers: {authorization: `Bearer ${leaseToken}`},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{cancel: boolean; lease_token: string}>();
    expect(body).toEqual({cancel: false, lease_token: expect.any(String)});
    const refreshedLease = await verifyJobLeaseToken(body.lease_token);
    expect(refreshedLease).toMatchObject({jobId, executionId, runnerSessionId});
  });

  it('returns 200 + cancel:true after requestJobCancellation', async () => {
    const {jobId, executionId, leaseToken} = await claimAvailableJob();
    await requestJobCancellation({jobId});

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${jobId}/heartbeat`,
      headers: {authorization: `Bearer ${leaseToken}`},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{cancel: boolean; lease_token: string}>();
    expect(body).toEqual({cancel: true, lease_token: expect.any(String)});
    const refreshedLease = await verifyJobLeaseToken(body.lease_token);
    expect(refreshedLease).toMatchObject({jobId, executionId, runnerSessionId});
  });

  it('returns 404 when the jobId is unknown', async () => {
    const jobId = crypto.randomUUID();
    const leaseToken = await issueJobLeaseToken({
      jobId,
      runId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      workspaceId,
      runnerSessionId,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${jobId}/heartbeat`,
      headers: {authorization: `Bearer ${leaseToken}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('running-job-not-found');
  });

  it('returns 404 when the job belongs to a different session', async () => {
    const {jobId} = await claimAvailableJob();
    const otherSession = await runnerSessionFactory.create({workspaceId});
    const leaseToken = await issueJobLeaseToken({
      jobId,
      runId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      workspaceId,
      runnerSessionId: otherSession.id,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${jobId}/heartbeat`,
      headers: {authorization: `Bearer ${leaseToken}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('running-job-not-found');
  });

  it('returns 404 when the path job id does not match the lease token job id', async () => {
    const {leaseToken} = await claimAvailableJob();

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${crypto.randomUUID()}/heartbeat`,
      headers: {authorization: `Bearer ${leaseToken}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('lease-job-mismatch');
  });
});
