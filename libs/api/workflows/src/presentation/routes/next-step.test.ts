import {createLeaseTokenAuthMethod} from '@shipfox/api-auth';
import {closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {eq} from 'drizzle-orm';
import {JobNotFoundError} from '#core/errors.js';
import {recordStepResult as recordExecutionStepResult} from '#core/job-execution.js';
import {db} from '#db/db.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {getStepsByJobId} from '#db/workflow-runs.js';
import {arrangeJobWithSteps} from '#test/fixtures/job-with-steps.js';
import {mintLeaseToken} from '#test/fixtures/lease-token.js';
import {leaseTokenRouteGroup} from './index.js';

const URL = '/runs/jobs/current/steps/next';

async function recordStepResult(
  params: Omit<Parameters<typeof recordExecutionStepResult>[0], 'executionId'> & {jobId: string},
) {
  const steps = await getStepsByJobId(params.jobId);
  const step = steps.find((candidate) => candidate.id === params.stepId);
  if (!step) throw new JobNotFoundError(params.jobId);
  const {jobId: _jobId, ...rest} = params;
  return recordExecutionStepResult({...rest, executionId: step.executionId});
}

describe('POST /runs/jobs/current/steps/next', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp({
      auth: [createLeaseTokenAuthMethod()],
      routes: [leaseTokenRouteGroup],
      swagger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await closeApp();
  });

  describe('lease-token auth', () => {
    test('rejects a request without an Authorization header', async () => {
      const res = await app.inject({method: 'POST', url: URL});

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('unauthorized');
    });

    test('rejects a non-bearer Authorization header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: URL,
        headers: {authorization: 'Token abc'},
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('unauthorized');
    });

    test('rejects a garbage token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: URL,
        headers: {authorization: 'Bearer not-a-token'},
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('unauthorized');
    });

    test('rejects an expired token', async () => {
      const token = await mintLeaseToken({
        jobId: crypto.randomUUID(),
        executionId: crypto.randomUUID(),
        expiresIn: '-1s',
      });

      const res = await app.inject({
        method: 'POST',
        url: URL,
        headers: {authorization: `Bearer ${token}`},
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('unauthorized');
    });

    test('rejects a token signed with the wrong secret', async () => {
      const token = await mintLeaseToken({
        jobId: crypto.randomUUID(),
        executionId: crypto.randomUUID(),
        secret: 'wrong-secret',
      });

      const res = await app.inject({
        method: 'POST',
        url: URL,
        headers: {authorization: `Bearer ${token}`},
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('unauthorized');
    });

    test('rejects a token with the wrong audience (e.g. a user JWT)', async () => {
      const token = await mintLeaseToken({
        jobId: crypto.randomUUID(),
        executionId: crypto.randomUUID(),
        audience: 'user-session',
      });

      const res = await app.inject({
        method: 'POST',
        url: URL,
        headers: {authorization: `Bearer ${token}`},
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('unauthorized');
    });
  });

  test('returns the lowest-position pending step and marks it running', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(3);
    const token = await mintLeaseToken({jobId});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kind).toBe('step');
    expect(body.step.id).toBe(steps[0]?.id);
    expect(body.step.status).toBe('running');
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('running');
    expect(after[1]?.status).toBe('pending');
  });

  test('re-delivers the in-flight step on a retried pull', async () => {
    const {jobId} = await arrangeJobWithSteps(3);
    const token = await mintLeaseToken({jobId});
    const first = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    const second = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().step.id).toBe(first.json().step.id);
    const running = (await getStepsByJobId(jobId)).filter((s) => s.status === 'running');
    expect(running).toHaveLength(1);
  });

  test('returns 404 for a valid token naming an unknown job', async () => {
    const token = await mintLeaseToken({
      jobId: crypto.randomUUID(),
      executionId: crypto.randomUUID(),
    });

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('job-not-found');
  });

  test('reports {done, succeeded} once every step succeeded', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const token = await mintLeaseToken({jobId});
    for (const step of steps) {
      await app.inject({method: 'POST', url: URL, headers: {authorization: `Bearer ${token}`}});
      await recordStepResult({jobId, stepId: step.id, status: 'succeeded'});
    }

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({kind: 'done', status: 'succeeded'});
  });

  test('reports {done, failed} after a failed step cancelled the rest', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const token = await mintLeaseToken({jobId});
    await app.inject({method: 'POST', url: URL, headers: {authorization: `Bearer ${token}`}});
    await recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'failed'});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({kind: 'done', status: 'failed'});
  });

  test('concurrent pulls hand out the same step exactly once', async () => {
    const {jobId} = await arrangeJobWithSteps(3);
    const token = await mintLeaseToken({jobId});

    const responses = await Promise.all(
      Array.from({length: 5}, () =>
        app.inject({method: 'POST', url: URL, headers: {authorization: `Bearer ${token}`}}),
      ),
    );

    const ids = responses.map((res) => {
      expect(res.statusCode).toBe(200);
      return res.json().step.id;
    });
    expect(new Set(ids).size).toBe(1);
    const running = (await getStepsByJobId(jobId)).filter((s) => s.status === 'running');
    expect(running).toHaveLength(1);
  });

  test("returns the step's current attempt so the runner can echo it", async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    // Simulate a durable restart having bumped the first step's current attempt.
    await db()
      .update(stepsTable)
      .set({currentAttempt: 2})
      .where(eq(stepsTable.id, steps[0]?.id as string));
    const token = await mintLeaseToken({jobId});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().attempt).toBe(2);
  });
});
