import {AUTH_USER} from '@shipfox/api-auth-context';
import {type AuthMethod, closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {nextStepForJob} from '#core/job-execution.js';
import {getStepsByJobId} from '#db/workflow-runs.js';
import {createLeaseTokenAuthMethod} from '#presentation/auth/lease-token-auth.js';
import {arrangeJobWithSteps} from '#test/fixtures/job-with-steps.js';
import {mintLeaseToken} from '#test/fixtures/lease-token.js';
import {workflowRoutes} from './index.js';

// The user-auth group rides along in workflowRoutes; a pass-through stub keeps
// createApp's auth-name validation satisfied without involving user auth.
const stubUserAuth: AuthMethod = {name: AUTH_USER, authenticate: () => Promise.resolve()};

function reportUrl(stepId: string): string {
  return `/runs/jobs/current/steps/${stepId}/report`;
}

describe('POST /runs/jobs/current/steps/:stepId/report', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp({
      auth: [stubUserAuth, createLeaseTokenAuthMethod()],
      routes: workflowRoutes,
      swagger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await closeApp();
  });

  test('rejects a request without a lease token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: reportUrl(crypto.randomUUID()),
      payload: {status: 'succeeded'},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
  });

  test('records a succeeded mid-job step → {ok, cancel:false}', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const token = await mintLeaseToken({jobId});
    await nextStepForJob(jobId);

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: {status: 'succeeded'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ok: true, cancel: false});
    expect((await getStepsByJobId(jobId))[0]?.status).toBe('succeeded');
  });

  test('finishing the job fully succeeded → {ok, cancel:false}', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const token = await mintLeaseToken({jobId});
    await nextStepForJob(jobId);

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: {status: 'succeeded'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ok: true, cancel: false});
  });

  test('a failed report cancels the remaining steps → {ok, cancel:true}', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(3);
    const token = await mintLeaseToken({jobId});
    await nextStepForJob(jobId);

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: {status: 'failed'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ok: true, cancel: true});
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('failed');
    expect(after[1]?.status).toBe('cancelled');
    expect(after[2]?.status).toBe('cancelled');
  });

  test('persists the wire error snake_case fields as camelCase on the step row', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const token = await mintLeaseToken({jobId});
    await nextStepForJob(jobId);

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: {status: 'failed', error: {message: 'boom', exit_code: 1, signal: 'SIGKILL'}},
    });

    expect(res.statusCode).toBe(200);
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.error).toEqual({message: 'boom', exitCode: 1, signal: 'SIGKILL'});
  });

  test('a duplicate succeeded report is a no-op with the same response', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const token = await mintLeaseToken({jobId});
    await nextStepForJob(jobId);
    const first = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: {status: 'succeeded'},
    });

    const second = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: {status: 'succeeded'},
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('succeeded');
    expect(after[1]?.status).toBe('pending');
  });

  test('a late succeeded report on a dead job never downgrades and says cancel', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const token = await mintLeaseToken({jobId});
    await nextStepForJob(jobId);
    await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: {status: 'failed'},
    });

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: {status: 'succeeded'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ok: true, cancel: true});
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('failed');
    expect(after[1]?.status).toBe('cancelled');
  });

  test('rejects a result for a pending (never-dispatched) step with 409', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const token = await mintLeaseToken({jobId});

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: {status: 'succeeded'},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('step-not-running');
  });

  test('rejects an unknown stepId with 404', async () => {
    const {jobId} = await arrangeJobWithSteps(1);
    const token = await mintLeaseToken({jobId});

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(crypto.randomUUID()),
      headers: {authorization: `Bearer ${token}`},
      payload: {status: 'succeeded'},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('step-not-found');
  });

  test("rejects another job's stepId with 404", async () => {
    const a = await arrangeJobWithSteps(1);
    const b = await arrangeJobWithSteps(1);
    const token = await mintLeaseToken({jobId: a.jobId});
    await nextStepForJob(b.jobId);

    const res = await app.inject({
      method: 'POST',
      url: reportUrl(b.steps[0]?.id as string),
      headers: {authorization: `Bearer ${token}`},
      payload: {status: 'succeeded'},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('step-not-found');
  });

  test('concurrent duplicate reports all succeed and land one result', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const token = await mintLeaseToken({jobId});
    await nextStepForJob(jobId);

    const responses = await Promise.all(
      Array.from({length: 5}, () =>
        app.inject({
          method: 'POST',
          url: reportUrl(steps[0]?.id as string),
          headers: {authorization: `Bearer ${token}`},
          payload: {status: 'succeeded'},
        }),
      ),
    );

    for (const res of responses) {
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ok: true, cancel: false});
    }
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('succeeded');
    expect(after[1]?.status).toBe('pending');
  });
});
