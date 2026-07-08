import {createLeaseTokenAuthMethod} from '@shipfox/api-auth';
import {AUTH_LEASED_JOB} from '@shipfox/api-auth-context';
import {closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {annotations} from '#db/schema/annotations.js';
import {mintLeaseToken} from '#test/index.js';
import {writeAnnotationsRoute} from './write-annotations.js';

function annotationsUrl(): string {
  return '/runs/jobs/current/annotations';
}

function mintTestLeaseToken(params: {
  jobId?: string;
  jobExecutionId?: string;
  stepId?: string;
  attempt?: number;
}): Promise<string> {
  return mintLeaseToken({
    jobId: params.jobId ?? crypto.randomUUID(),
    jobExecutionId: params.jobExecutionId ?? crypto.randomUUID(),
    ...(params.stepId
      ? {currentStepId: params.stepId, currentStepAttempt: params.attempt ?? 1}
      : {}),
  });
}

describe('POST /runs/jobs/current/annotations', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp({
      auth: [createLeaseTokenAuthMethod()],
      routes: [
        {prefix: '/runs/jobs/current', auth: AUTH_LEASED_JOB, routes: [writeAnnotationsRoute]},
      ],
      swagger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('rejects a request without a lease token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: annotationsUrl(),
      payload: {step_id: crypto.randomUUID(), attempt: 1, annotations: []},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
  });

  it('accepts a scoped lease and writes annotations from lease identity', async () => {
    const stepId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const jobExecutionId = crypto.randomUUID();
    const token = await mintTestLeaseToken({jobId, jobExecutionId, stepId});

    const res = await app.inject({
      method: 'POST',
      url: annotationsUrl(),
      headers: {authorization: `Bearer ${token}`},
      payload: {
        step_id: stepId,
        attempt: 1,
        annotations: [{context: 'deploy', style: 'success', op: 'replace', body: 'done'}],
      },
    });

    const rows = await db()
      .select()
      .from(annotations)
      .where(eq(annotations.jobExecutionId, jobExecutionId));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      annotations: [{context: 'deploy', id: rows[0]?.id}],
      accounting: {annotation_count: 1, total_body_bytes: 4},
    });
    expect(rows[0]).toMatchObject({
      jobId,
      originStepId: stepId,
      originStepAttempt: 1,
      context: 'deploy',
      body: 'done',
    });
  });

  it('rejects writes for a step outside the leased execution', async () => {
    const token = await mintTestLeaseToken({stepId: crypto.randomUUID()});

    const res = await app.inject({
      method: 'POST',
      url: annotationsUrl(),
      headers: {authorization: `Bearer ${token}`},
      payload: {
        step_id: crypto.randomUUID(),
        attempt: 1,
        annotations: [{context: 'deploy', body: 'wrong step'}],
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('step-not-found');
  });

  it('rejects writes for a different attempt than the leased step scope', async () => {
    const stepId = crypto.randomUUID();
    const token = await mintTestLeaseToken({stepId, attempt: 1});

    const res = await app.inject({
      method: 'POST',
      url: annotationsUrl(),
      headers: {authorization: `Bearer ${token}`},
      payload: {
        step_id: stepId,
        attempt: 2,
        annotations: [{context: 'deploy', body: 'wrong attempt'}],
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('step-not-found');
  });

  it('rejects writes with a job-scoped lease token', async () => {
    const token = await mintLeaseToken({
      jobId: crypto.randomUUID(),
      jobExecutionId: crypto.randomUUID(),
    });

    const res = await app.inject({
      method: 'POST',
      url: annotationsUrl(),
      headers: {authorization: `Bearer ${token}`},
      payload: {
        step_id: crypto.randomUUID(),
        attempt: 1,
        annotations: [{context: 'deploy', body: 'job scoped'}],
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('step-not-found');
  });

  it('accepts an empty operation list and returns current accounting', async () => {
    const stepId = crypto.randomUUID();
    const token = await mintTestLeaseToken({stepId});

    const res = await app.inject({
      method: 'POST',
      url: annotationsUrl(),
      headers: {authorization: `Bearer ${token}`},
      payload: {step_id: stepId, attempt: 1, annotations: []},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      annotations: [],
      accounting: {annotation_count: 0, total_body_bytes: 0},
    });
  });

  it('maps annotation count budget failures to a specific client code', async () => {
    const stepId = crypto.randomUUID();
    const token = await mintTestLeaseToken({stepId});
    const operations = Array.from({length: 51}, (_, index) => ({
      context: `context-${index}`,
      op: 'replace',
      body: 'x',
    }));

    const res = await app.inject({
      method: 'POST',
      url: annotationsUrl(),
      headers: {authorization: `Bearer ${token}`},
      payload: {step_id: stepId, attempt: 1, annotations: operations},
    });

    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe('annotation-count-limit-exceeded');
  });
});
