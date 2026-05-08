import {AUTH_API_KEY, AUTH_USER} from '@shipfox/api-auth-context';
import {RUNNER_JOB_COMPLETED} from '@shipfox/api-runners-dto';
import type {AuthMethod} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {eq, sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {db} from '#db/db.js';
import {claimJob} from '#db/jobs.js';
import {revokeRunnerToken} from '#db/runner-tokens.js';
import {runnersOutbox} from '#db/schema/outbox.js';
import {runningJobs} from '#db/schema/running-jobs.js';
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

describe('POST /runners/jobs/:jobId/complete', () => {
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

  function buildSucceededBody(stepId: string) {
    return {
      status: 'succeeded' as const,
      steps: [{step_id: stepId, status: 'succeeded' as const, error: null}],
    };
  }

  it('returns 401 without authorization', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${crypto.randomUUID()}/complete`,
      payload: buildSucceededBody(crypto.randomUUID()),
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with an invalid runner token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${crypto.randomUUID()}/complete`,
      headers: {authorization: 'Bearer invalid'},
      payload: buildSucceededBody(crypto.randomUUID()),
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 200 on successful completion and outbox event carries steps', async () => {
    const pending = await pendingJobFactory.create({workspaceId});
    const claimed = await claimJob({workspaceId, runnerTokenId});
    const stepId = pending.payload.steps[0]?.id ?? crypto.randomUUID();

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${pending.jobId}/complete`,
      headers: {authorization: `Bearer ${rawToken}`},
      payload: buildSucceededBody(stepId),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ok: true});

    const running = await db().select().from(runningJobs);
    const outboxRows = await db().select().from(runnersOutbox);
    expect(claimed?.jobId).toBe(pending.jobId);
    expect(running).toHaveLength(0);
    expect(outboxRows[0]?.eventType).toBe(RUNNER_JOB_COMPLETED);
    const payload = outboxRows[0]?.payload as {steps: unknown[]};
    expect(payload.steps).toHaveLength(1);
  });

  it('allows a revoked token to complete a job it already owns', async () => {
    const pending = await pendingJobFactory.create({workspaceId});
    await claimJob({workspaceId, runnerTokenId});
    await revokeRunnerToken({tokenId: runnerTokenId, workspaceId});
    const stepId = pending.payload.steps[0]?.id ?? crypto.randomUUID();

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${pending.jobId}/complete`,
      headers: {authorization: `Bearer ${rawToken}`},
      payload: buildSucceededBody(stepId),
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns 404 when the job is not running for this runner token', async () => {
    const pending = await pendingJobFactory.create({workspaceId});
    const otherRawToken = `sf_r_${crypto.randomUUID()}`;
    await runnerTokenFactory.create({workspaceId}, {transient: {rawToken: otherRawToken}});
    await claimJob({workspaceId, runnerTokenId});
    const stepId = pending.payload.steps[0]?.id ?? crypto.randomUUID();

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${pending.jobId}/complete`,
      headers: {authorization: `Bearer ${otherRawToken}`},
      payload: buildSucceededBody(stepId),
    });

    const running = await db()
      .select()
      .from(runningJobs)
      .where(eq(runningJobs.jobId, pending.jobId));
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('running-job-not-found');
    expect(running).toHaveLength(1);
  });

  it('returns 400 when body is missing status', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${crypto.randomUUID()}/complete`,
      headers: {authorization: `Bearer ${rawToken}`},
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects status=succeeded with empty steps[] (strict refine)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${crypto.randomUUID()}/complete`,
      headers: {authorization: `Bearer ${rawToken}`},
      payload: {status: 'succeeded', steps: []},
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects status=succeeded with a failed step (strict refine)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${crypto.randomUUID()}/complete`,
      headers: {authorization: `Bearer ${rawToken}`},
      payload: {
        status: 'succeeded',
        steps: [
          {step_id: crypto.randomUUID(), status: 'succeeded', error: null},
          {
            step_id: crypto.randomUUID(),
            status: 'failed',
            error: {message: 'boom', exitCode: 1},
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('accepts status=failed with empty steps[] (executor-throws / stuck path)', async () => {
    const pending = await pendingJobFactory.create({workspaceId});
    await claimJob({workspaceId, runnerTokenId});

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${pending.jobId}/complete`,
      headers: {authorization: `Bearer ${rawToken}`},
      payload: {status: 'failed', steps: []},
    });

    expect(res.statusCode).toBe(200);
  });

  it('accepts status=failed with mixed step statuses (mid-job failure)', async () => {
    const pending = await pendingJobFactory.create({workspaceId});
    await claimJob({workspaceId, runnerTokenId});
    const stepId = pending.payload.steps[0]?.id ?? crypto.randomUUID();

    const res = await app.inject({
      method: 'POST',
      url: `/runners/jobs/${pending.jobId}/complete`,
      headers: {authorization: `Bearer ${rawToken}`},
      payload: {
        status: 'failed',
        steps: [
          {step_id: stepId, status: 'succeeded', error: null},
          {
            step_id: crypto.randomUUID(),
            status: 'failed',
            error: {message: 'Command exited with code 1', exitCode: 1},
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
  });
});
