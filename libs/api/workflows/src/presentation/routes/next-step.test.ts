import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';
import {
  MAX_RESOLVED_STEP_CONFIG_BYTES,
  RUNNER_NEXT_STEP_RESPONSE_BUDGET_BYTES,
} from '@shipfox/api-workflows-dto';
import {createWorkflowExpression} from '@shipfox/expression';
import {closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {eq} from 'drizzle-orm';
import type {Step} from '#core/entities/step.js';
import {JobNotFoundError} from '#core/errors.js';
import {
  nextStepForJob,
  recordStepResult as recordJobExecutionStepResult,
} from '#core/job-execution.js';
import {db, withTransaction} from '#db/db.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {
  getFirstJobExecutionByJobId,
  getJobById,
  getStepsByJobId,
  getToolInvocationsByJobExecutionId,
  getWorkflowRunByAttemptId,
  insertRunningStepAttempt,
} from '#db/workflow-runs.js';
import {insertRunningJobLease, mintActiveLeaseToken} from '#test/fixtures/active-lease-token.js';
import {agentTestClient} from '#test/fixtures/agent-inter-module.js';
import {workflowsTestAuthClient} from '#test/fixtures/auth-inter-module.js';
import {arrangeJobWithSteps} from '#test/fixtures/job-with-steps.js';
import {
  fakeLeaseTokenAuthMethod,
  getLeaseTokenClaims,
  mintLeaseToken,
} from '#test/fixtures/lease-token.js';
import {projectsTestClient} from '#test/fixtures/projects-inter-module.js';
import {
  runnersTestClient,
  setRunnerToolCapabilities as setTestRunnerToolCapabilities,
} from '#test/fixtures/runners-inter-module.js';
import {createTestSecretsClient} from '#test/fixtures/secrets-inter-module.js';
import {createLeaseTokenRouteGroup} from './index.js';
import {serializedResponseByteLength} from './serialized-response-byte-length.js';

const nextStepMetricMocks = vi.hoisted(() => ({
  recordWorkflowNextStepResponseOverflow: vi.fn(),
  recordWorkflowNextStepResponseSize: vi.fn(),
}));

vi.mock('#metrics/instance.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#metrics/instance.js')>()),
  ...nextStepMetricMocks,
}));

const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@shipfox/node-error-monitoring', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shipfox/node-error-monitoring')>()),
  captureException: captureExceptionMock,
}));

const URL = '/runs/jobs/current/steps/next';
const RUN_CONFIG_JSON_OVERHEAD_BYTES = Buffer.byteLength(JSON.stringify({run: ''}) ?? '', 'utf8');

async function recordStepResult(
  params: Omit<Parameters<typeof recordJobExecutionStepResult>[0], 'jobExecutionId'> & {
    jobId: string;
  },
) {
  const steps = await getStepsByJobId(params.jobId);
  const step = steps.find((candidate) => candidate.id === params.stepId);
  if (!step) throw new JobNotFoundError(params.jobId);
  const {jobId: _jobId, ...rest} = params;
  return recordJobExecutionStepResult({...rest, jobExecutionId: step.jobExecutionId});
}

function setRunnerToolCapabilities(
  runnerSessionId: string,
  capabilities: Parameters<typeof setTestRunnerToolCapabilities>[1]['capabilities'],
): void {
  setTestRunnerToolCapabilities(runnerSessionId, {capabilities});
}

const annotationWrites = vi.fn<AnnotationsInterModuleClient['replaceOrRemoveAnnotation']>();
const annotationsTestClient: AnnotationsInterModuleClient = {
  replaceOrRemoveAnnotation: annotationWrites.mockResolvedValue({}),
  listAnnotationsForRunAttempt: vi.fn(),
};

describe('POST /runs/jobs/current/steps/next', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    nextStepMetricMocks.recordWorkflowNextStepResponseOverflow.mockClear();
    nextStepMetricMocks.recordWorkflowNextStepResponseSize.mockClear();
    captureExceptionMock.mockClear();
  });

  beforeAll(async () => {
    app = await createApp({
      auth: [fakeLeaseTokenAuthMethod],
      routes: [
        createLeaseTokenRouteGroup({
          agent: agentTestClient,
          annotations: annotationsTestClient,
          auth: workflowsTestAuthClient,
          definitions: {} as never,
          integrations: {} as never,
          projects: projectsTestClient,
          runners: runnersTestClient,
          secrets: createTestSecretsClient(),
        }),
      ],
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
  });

  test('returns the lowest-position pending step and marks it running', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(3);
    const token = await mintActiveLeaseToken({
      renewableInference: false,
      jobId,
    });
    const lease = getLeaseTokenClaims(token);
    if (!lease) throw new Error('Expected minted lease token to verify');
    const getLeaseState = vi.spyOn(runnersTestClient, 'getLeaseState');

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(getLeaseState).toHaveBeenCalledWith({
      jobId: lease.jobId,
      jobExecutionId: lease.jobExecutionId,
      runnerSessionId: lease.runnerSessionId,
    });
    const body = res.json();
    expect(body.kind).toBe('step');
    expect(body.step.id).toBe(steps[0]?.id);
    expect(body.step.status).toBe('running');
    expect(body.lease_token).toEqual(expect.any(String));
    const scopedLease = getLeaseTokenClaims(body.lease_token);
    expect(scopedLease).toMatchObject({
      jobId,
      jobExecutionId: steps[0]?.jobExecutionId,
      currentStepId: steps[0]?.id,
      currentStepAttempt: 1,
    });
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('running');
    expect(after[1]?.status).toBe('pending');
  });

  test('serves a maximum-valid resolved config within the complete response budget', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const step = steps[0];
    if (!step) throw new Error('Expected a step');
    const config = {
      run: 'x'.repeat(MAX_RESOLVED_STEP_CONFIG_BYTES - RUN_CONFIG_JSON_OVERHEAD_BYTES),
    };
    await db().update(stepsTable).set({config, configPlan: null}).where(eq(stepsTable.id, step.id));
    const token = await mintActiveLeaseToken({
      renewableInference: false,
      jobId,
    });

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().step.config).toEqual(config);
    expect(serializedResponseByteLength(res.rawPayload)).toBeLessThanOrEqual(
      RUNNER_NEXT_STEP_RESPONSE_BUDGET_BYTES,
    );
  });

  test('serves an over-budget legacy step and captures the overflow once', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const step = steps[0];
    if (!step) throw new Error('Expected a workflow step');

    await nextStepForJob(jobId);
    const config = {
      run: 'x'.repeat(
        RUNNER_NEXT_STEP_RESPONSE_BUDGET_BYTES + 2_000 - RUN_CONFIG_JSON_OVERHEAD_BYTES,
      ),
    };
    await db().update(stepsTable).set({config, configPlan: null}).where(eq(stepsTable.id, step.id));
    const token = await mintActiveLeaseToken({
      renewableInference: false,
      jobId,
    });
    const headers = {authorization: `Bearer ${token}`};

    const first = await app.inject({method: 'POST', url: URL, headers});
    const second = await app.inject({method: 'POST', url: URL, headers});

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().step.config).toEqual(config);
    expect(second.json().step.id).toBe(first.json().step.id);
    expect(nextStepMetricMocks.recordWorkflowNextStepResponseSize).toHaveBeenCalledTimes(2);
    for (const [kind, bytes] of nextStepMetricMocks.recordWorkflowNextStepResponseSize.mock.calls) {
      expect(kind).toBe('step');
      expect(bytes).toBeGreaterThan(RUNNER_NEXT_STEP_RESPONSE_BUDGET_BYTES);
    }
    expect(nextStepMetricMocks.recordWorkflowNextStepResponseOverflow).toHaveBeenCalledTimes(2);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  test('re-delivers the in-flight step on a retried pull', async () => {
    const {jobId} = await arrangeJobWithSteps(3);
    const token = await mintActiveLeaseToken({
      renewableInference: false,
      jobId,
    });
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

  test('returns the tool wait protocol and keeps one queued invocation', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const step = steps[0];
    if (!step) throw new Error('Expected a tool step');
    await db()
      .update(stepsTable)
      .set({
        type: 'tool',
        config: {
          tool: {
            connection_id: 'connection-1',
            id: 'issue_read',
            input_schema: {type: 'object', additionalProperties: false},
            with: {},
          },
        },
        configPlan: null,
      })
      .where(eq(stepsTable.id, step.id));
    const token = await mintActiveLeaseToken({
      renewableInference: false,
      jobId,
    });
    const headers = {authorization: `Bearer ${token}`};

    const first = await app.inject({method: 'POST', url: URL, headers});
    const second = await app.inject({method: 'POST', url: URL, headers});

    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({kind: 'wait', retry_after_ms: 1000});
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({kind: 'wait', retry_after_ms: 1000});
    expect(nextStepMetricMocks.recordWorkflowNextStepResponseSize).toHaveBeenNthCalledWith(
      1,
      'wait',
      serializedResponseByteLength(first.rawPayload),
    );
    expect(nextStepMetricMocks.recordWorkflowNextStepResponseSize).toHaveBeenNthCalledWith(
      2,
      'wait',
      serializedResponseByteLength(second.rawPayload),
    );

    const invocations = await getToolInvocationsByJobExecutionId(step.jobExecutionId);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      stepId: step.id,
      jobExecutionId: step.jobExecutionId,
      status: 'queued',
      callIndex: 0,
    });
  });

  test('writes the tool capability warning only on fresh dispatch', async () => {
    annotationWrites.mockClear();
    const {jobId, steps} = await arrangeJobWithSteps(1);
    await db()
      .update(stepsTable)
      .set({
        type: 'agent',
        config: {
          harness: 'pi',
          provider: 'anthropic',
          model: 'claude-opus-4-8',
          thinking: 'high',
          tools: ['read', 'web_search'],
          prompt: 'Fix it.',
        },
      })
      .where(eq(stepsTable.id, steps[0]?.id as string));
    const token = await mintActiveLeaseToken({
      renewableInference: false,
      jobId,
    });
    const lease = getLeaseTokenClaims(token);
    if (!lease) throw new Error('Expected minted lease token to verify');
    setRunnerToolCapabilities(lease.runnerSessionId, {harnesses: {pi: {tools: ['read']}}});

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

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(annotationWrites).toHaveBeenCalledTimes(1);
    expect(annotationWrites).toHaveBeenCalledWith(
      expect.objectContaining({
        jobExecutionId: lease.jobExecutionId,
        annotation: expect.objectContaining({op: 'replace'}),
      }),
    );
  });

  test('defers the renewable Git upgrade warning until credentials are resolved', async () => {
    annotationWrites.mockClear();
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const step = steps[0];
    if (!step) throw new Error('Expected a step');
    await db()
      .update(stepsTable)
      .set({
        type: 'checkout',
        config: {
          checkout: {
            repository: 'acme/repository',
            persist_credentials: true,
          },
        },
      })
      .where(eq(stepsTable.id, step.id));
    const token = await mintActiveLeaseToken({
      renewableInference: false,
      jobId,
    });
    const lease = getLeaseTokenClaims(token);
    if (!lease) throw new Error('Expected minted lease token to verify');
    setRunnerToolCapabilities(lease.runnerSessionId, {harnesses: {}});

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

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(annotationWrites).not.toHaveBeenCalled();
  });

  test('returns 404 for a valid token without an active lease', async () => {
    const token = await mintLeaseToken({
      jobId: crypto.randomUUID(),
      jobExecutionId: crypto.randomUUID(),
    });

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('lease-not-active');
  });

  test('returns 404 when the lease token is no longer the active job lease', async () => {
    const {jobId} = await arrangeJobWithSteps(1);
    const jobExecution = await getFirstJobExecutionByJobId(jobId);
    if (!jobExecution) throw new Error('Expected job execution to exist');
    const job = await getJobById(jobId);
    if (!job) throw new Error('Expected job to exist');
    const run = await getWorkflowRunByAttemptId(job.workflowRunAttemptId);
    if (!run) throw new Error('Expected workflow run to exist');
    await insertRunningJobLease({
      renewableInference: false,
      workspaceId: run.workspaceId,
      workflowRunId: run.id,
      workflowRunAttemptId: job.workflowRunAttemptId,
      jobId,
      jobExecutionId: jobExecution.id,
      projectId: run.projectId,
      runnerSessionId: crypto.randomUUID(),
    });
    const token = await mintLeaseToken({
      jobId,
      jobExecutionId: jobExecution.id,
      workflowRunId: run.id,
      workflowRunAttemptId: job.workflowRunAttemptId,
      projectId: run.projectId,
      workspaceId: run.workspaceId,
      runnerSessionId: crypto.randomUUID(),
    });

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('lease-not-active');
  });

  test('reports {done, succeeded} once every step succeeded', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const token = await mintActiveLeaseToken({
      renewableInference: false,
      jobId,
    });
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
    expect(nextStepMetricMocks.recordWorkflowNextStepResponseSize).toHaveBeenCalledWith(
      'done',
      serializedResponseByteLength(res.rawPayload),
    );
  });

  test('reports {done, failed} after a failed step skips the default-gated rest', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const token = await mintActiveLeaseToken({
      renewableInference: false,
      jobId,
    });
    await app.inject({method: 'POST', url: URL, headers: {authorization: `Bearer ${token}`}});
    await recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'failed'});

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({kind: 'done', status: 'failed'});
    expect(nextStepMetricMocks.recordWorkflowNextStepResponseSize).toHaveBeenCalledWith(
      'done',
      serializedResponseByteLength(res.rawPayload),
    );
  });

  test('concurrent pulls hand out the same step exactly once', async () => {
    const {jobId} = await arrangeJobWithSteps(3);
    const token = await mintActiveLeaseToken({
      renewableInference: false,
      jobId,
    });

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
    const token = await mintActiveLeaseToken({
      renewableInference: false,
      jobId,
    });

    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.attempt).toBe(2);
    const scopedLease = getLeaseTokenClaims(body.lease_token);
    expect(scopedLease?.currentStepId).toBe(steps[0]?.id);
    expect(scopedLease?.currentStepAttempt).toBe(body.attempt);
  });

  describe('env_sources', () => {
    async function pull(token: string) {
      const res = await app.inject({
        method: 'POST',
        url: URL,
        headers: {authorization: `Bearer ${token}`},
      });
      expect(res.statusCode).toBe(200);
      return res.json();
    }

    async function pullAndSucceed(token: string, jobId: string, step: Step) {
      await pull(token);
      await recordStepResult({jobId, stepId: step.id, status: 'succeeded', exitCode: 0});
    }

    function skipWhen(step: Step, source: string) {
      return db()
        .update(stepsTable)
        .set({condition: createWorkflowExpression({source, check: {mode: 'syntax'}})})
        .where(eq(stepsTable.id, step.id));
    }

    // `lead` is never rewound. `reviewer` fails its gate and restarts from `producer`.
    async function arrangeRestartingJob() {
      const {jobId, steps} = await arrangeJobWithSteps(3);
      const [lead, producer, reviewer] = steps as [Step, Step, Step];
      await db()
        .update(stepsTable)
        .set({
          config: {
            run: 'review',
            gate: {
              success: {language: 'cel', check: 'syntax', source: 'step.exit_code == 0'},
              on_failure: {restart_from: 'producer'},
            },
          },
        })
        .where(eq(stepsTable.id, reviewer.id));
      await db().update(stepsTable).set({key: 'producer'}).where(eq(stepsTable.id, producer.id));
      const token = await mintActiveLeaseToken({renewableInference: false, jobId});
      await pullAndSucceed(token, jobId, lead);
      await pullAndSucceed(token, jobId, producer);
      await pull(token);
      await recordStepResult({
        jobId,
        stepId: reviewer.id,
        status: 'failed',
        error: {message: 'exit 1'},
        exitCode: 1,
      });
      return {jobId, token, lead, producer, reviewer};
    }

    test('is empty for the first step of a job', async () => {
      const {jobId} = await arrangeJobWithSteps(2);
      const token = await mintActiveLeaseToken({renewableInference: false, jobId});

      expect((await pull(token)).env_sources).toEqual([]);
    });

    test('lists the earlier executed steps in position order', async () => {
      const {jobId, steps} = await arrangeJobWithSteps(3);
      const [first, second] = steps as [Step, Step, Step];
      const token = await mintActiveLeaseToken({renewableInference: false, jobId});
      await pullAndSucceed(token, jobId, first);
      await pullAndSucceed(token, jobId, second);

      expect((await pull(token)).env_sources).toEqual([
        {position: first.position, attempt: 1},
        {position: second.position, attempt: 1},
      ]);
    });

    test('lists the same sources when the running step is re-delivered', async () => {
      const {jobId, steps} = await arrangeJobWithSteps(2);
      const token = await mintActiveLeaseToken({renewableInference: false, jobId});
      await pullAndSucceed(token, jobId, steps[0] as Step);

      const first = await pull(token);
      const second = await pull(token);

      expect(second.step.id).toBe(first.step.id);
      expect(second.env_sources).toEqual([{position: steps[0]?.position, attempt: 1}]);
      expect(second.env_sources).toEqual(first.env_sources);
    });

    test('never lists a skipped step', async () => {
      const {jobId, steps} = await arrangeJobWithSteps(3);
      const [first, skipped, last] = steps as [Step, Step, Step];
      const token = await mintActiveLeaseToken({renewableInference: false, jobId});
      await pullAndSucceed(token, jobId, first);
      await skipWhen(skipped, 'false');

      const body = await pull(token);

      expect(body.step.id).toBe(last.id);
      expect(body.env_sources).toEqual([{position: first.position, attempt: 1}]);
    });

    test('lists an earlier step whose attempt failed', async () => {
      const {jobId, steps} = await arrangeJobWithSteps(2);
      const [failed, cleanup] = steps as [Step, Step];
      const token = await mintActiveLeaseToken({renewableInference: false, jobId});
      await pull(token);
      await recordStepResult({
        jobId,
        stepId: failed.id,
        status: 'failed',
        error: {message: 'exit 1'},
        exitCode: 1,
      });
      await skipWhen(cleanup, 'true');
      await db().update(stepsTable).set({runAfter: 'always'}).where(eq(stepsTable.id, cleanup.id));

      const body = await pull(token);

      expect(body.step.id).toBe(cleanup.id);
      expect(body.env_sources).toEqual([{position: failed.position, attempt: 1}]);
    });

    test('never lists a tool step', async () => {
      const {jobId, steps} = await arrangeJobWithSteps(3);
      const [first, tool, last] = steps as [Step, Step, Step];
      const token = await mintActiveLeaseToken({renewableInference: false, jobId});
      await pullAndSucceed(token, jobId, first);
      // A server-run step settles with an attempt row, like an executed step.
      await db().update(stepsTable).set({type: 'tool'}).where(eq(stepsTable.id, tool.id));
      await withTransaction((tx) =>
        insertRunningStepAttempt(
          {jobExecutionId: tool.jobExecutionId, stepId: tool.id, attempt: 1},
          tx,
        ),
      );
      await db().update(stepsTable).set({status: 'succeeded'}).where(eq(stepsTable.id, tool.id));

      const body = await pull(token);

      expect(body.step.id).toBe(last.id);
      expect(body.env_sources).toEqual([{position: first.position, attempt: 1}]);
    });

    test('never lists a pending step', async () => {
      const {jobId, steps} = await arrangeJobWithSteps(3);
      const [first, pending, last] = steps as [Step, Step, Step];
      const token = await mintActiveLeaseToken({renewableInference: false, jobId});
      await pullAndSucceed(token, jobId, first);
      await db().update(stepsTable).set({status: 'pending'}).where(eq(stepsTable.id, pending.id));
      // Dispatch the step behind the pending one, as if the runner were ahead of the server.
      await db().update(stepsTable).set({status: 'running'}).where(eq(stepsTable.id, last.id));

      const body = await pull(token);

      expect(body.step.id).toBe(last.id);
      expect(body.env_sources).toEqual([{position: first.position, attempt: 1}]);
    });

    test('lists a restart target that runs again at its new attempt only', async () => {
      const {jobId, token, lead, producer, reviewer} = await arrangeRestartingJob();

      // The rewound producer is dispatched again: only `lead` still applies.
      const rerun = await pull(token);
      expect(rerun.step.id).toBe(producer.id);
      expect(rerun.attempt).toBe(2);
      expect(rerun.env_sources).toEqual([{position: lead.position, attempt: 1}]);

      await recordStepResult({jobId, stepId: producer.id, status: 'succeeded', exitCode: 0});

      const next = await pull(token);
      expect(next.step.id).toBe(reviewer.id);
      expect(next.env_sources).toEqual([
        {position: lead.position, attempt: 1},
        {position: producer.position, attempt: 2},
      ]);
    });

    test('omits a restart target that the rerun skips', async () => {
      const {jobId, token, lead, producer, reviewer} = await arrangeRestartingJob();
      await skipWhen(producer, 'false');

      const body = await pull(token);

      expect(body.step.id).toBe(reviewer.id);
      expect(body.env_sources).toEqual([{position: lead.position, attempt: 1}]);
      expect((await getStepsByJobId(jobId)).map((step) => step.status)).toEqual([
        'succeeded',
        'skipped',
        'running',
      ]);
    });
  });
});
