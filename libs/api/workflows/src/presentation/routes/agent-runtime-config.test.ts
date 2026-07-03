import {createCustomModelProviderConfig, testAndSaveModelProviderConfig} from '@shipfox/api-agent';
import {resolveRuntimeCredentials} from '@shipfox/api-agent/core/resolve-runtime-credentials';
import {createLeaseTokenAuthMethod} from '@shipfox/api-auth';
import type {WorkflowModel} from '@shipfox/api-definitions';
import {SecretDecryptionError} from '@shipfox/api-secrets';
import {closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {createCapturingLogger} from '@shipfox/node-log/test';
import {eq} from 'drizzle-orm';
import type {StepStatus} from '#core/entities/step.js';
import {db} from '#db/db.js';
import {jobs} from '#db/schema/jobs.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {createWorkflowRun, getJobsByWorkflowRunId, getStepsByJobId} from '#db/workflow-runs.js';
import {workflowModel} from '#test/factories/workflow-model.js';
import {insertRunningJobLease, mintActiveLeaseToken} from '#test/fixtures/active-lease-token.js';
import {mintLeaseToken} from '#test/fixtures/lease-token.js';
import {leaseTokenRouteGroup} from './index.js';

const {captureExceptionMock} = vi.hoisted(() => ({captureExceptionMock: vi.fn()}));
vi.mock('@shipfox/api-agent/core/resolve-runtime-credentials', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@shipfox/api-agent/core/resolve-runtime-credentials')>();
  return {...actual, resolveRuntimeCredentials: vi.fn(actual.resolveRuntimeCredentials)};
});
vi.mock('@shipfox/node-error-monitoring', () => ({captureException: captureExceptionMock}));

const URL = '/runs/jobs/current/agent-runtime-config';

describe('GET /runs/jobs/current/agent-runtime-config', () => {
  let app: FastifyInstance;
  const {logger, lines: logLines, clear: clearLogLines} = createCapturingLogger();

  beforeAll(async () => {
    app = await createApp({
      auth: [createLeaseTokenAuthMethod()],
      routes: [leaseTokenRouteGroup],
      swagger: false,
      fastifyOptions: {loggerInstance: logger},
    });
    await app.ready();
  });

  beforeEach(() => {
    clearLogLines();
    captureExceptionMock.mockReset();
    vi.mocked(resolveRuntimeCredentials).mockClear();
  });

  afterAll(async () => {
    await closeApp();
  });

  describe('lease-token auth', () => {
    test('rejects a request without an Authorization header', async () => {
      const res = await app.inject({method: 'GET', url: runtimeConfigUrl(crypto.randomUUID(), 1)});

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('unauthorized');
    });

    test('rejects an expired token', async () => {
      const token = await mintLeaseToken({
        jobId: crypto.randomUUID(),
        jobExecutionId: crypto.randomUUID(),
        expiresIn: '-1s',
      });

      const res = await app.inject({
        method: 'GET',
        url: runtimeConfigUrl(crypto.randomUUID(), 1),
        headers: {authorization: `Bearer ${token}`},
      });

      expect(res.statusCode).toBe(401);
    });

    test('rejects a token with the wrong audience', async () => {
      const token = await mintLeaseToken({
        jobId: crypto.randomUUID(),
        jobExecutionId: crypto.randomUUID(),
        audience: 'user-session',
      });

      const res = await app.inject({
        method: 'GET',
        url: runtimeConfigUrl(crypto.randomUUID(), 1),
        headers: {authorization: `Bearer ${token}`},
      });

      expect(res.statusCode).toBe(401);
    });
  });

  test('returns decrypted runtime credentials for a running leased agent step', async () => {
    const {run, job, step} = await createRunningAgentStep();
    await saveWorkspaceCredential(run.workspaceId, 'sk-workspace-secret');
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      provider_id: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      credentials: {api_key: 'sk-workspace-secret'},
    });
  });

  test('derives the credential workspace from the leased job instead of hostile lease claims', async () => {
    const {run, job, step} = await createRunningAgentStep();
    const hostileWorkspaceId = crypto.randomUUID();
    await saveWorkspaceCredential(run.workspaceId, 'sk-correct-workspace-secret');
    await saveWorkspaceCredential(hostileWorkspaceId, 'sk-hostile-workspace-secret');
    const token = await mintActiveLeaseToken({
      jobId: job.id,
      token: {workspaceId: hostileWorkspaceId},
    });

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().credentials.api_key).toBe('sk-correct-workspace-secret');
  });

  test('returns decrypted runtime credentials for a gated running agent step', async () => {
    const {run, job, step} = await createRunningAgentStep({
      steps: [
        {
          name: 'implement',
          model: 'claude-opus-4-8',
          provider: 'anthropic',
          thinking: 'high',
          prompt: 'Fix the tests.',
          gate: {successIf: expression('step.exit_code == 0')},
        },
      ],
    });
    await saveWorkspaceCredential(run.workspaceId, 'sk-gated-workspace-secret');
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().credentials.api_key).toBe('sk-gated-workspace-secret');
  });

  test('returns custom provider descriptors for a running leased custom agent step', async () => {
    const workspaceId = crypto.randomUUID();
    await createCustomModelProviderConfig(
      {
        workspaceId,
        body: {
          slug: 'local-vllm',
          display_name: 'Local vLLM',
          api: 'openai-responses',
          base_url: 'http://127.0.0.1:11434/v1',
          api_key: 'sk-local-secret',
          headers: [{name: 'authorization', value: 'Bearer local', secret: true}],
          models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
        },
      },
      {probe: async () => undefined},
    );
    const {job, step} = await createRunningAgentStep({
      workspaceId,
      resolveAgentDefaults: () => ({
        provider: 'local-vllm',
        model: 'llama-3.1',
        thinking: 'high',
      }),
      steps: [
        {
          provider: 'local-vllm',
          model: 'llama-3.1',
          thinking: 'high',
          prompt: 'Fix the tests.',
        },
      ],
    });
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      provider_id: 'local-vllm',
      model: 'llama-3.1',
      credentials: {
        api_key: 'sk-local-secret',
        'header:authorization': 'Bearer local',
      },
      custom_provider: {
        api: 'openai-responses',
        base_url: 'http://127.0.0.1:11434/v1',
        secret_header_names: ['authorization'],
        models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
      },
    });
  });

  test('returns 404 when the lease token is no longer the active job lease', async () => {
    const {run, job, step} = await createRunningAgentStep();
    await insertRunningJobLease({
      workspaceId: run.workspaceId,
      workflowRunId: run.id,
      workflowRunAttemptId: job.workflowRunAttemptId,
      jobId: job.id,
      jobExecutionId: step.jobExecutionId,
      projectId: run.projectId,
      runnerSessionId: crypto.randomUUID(),
    });
    const token = await mintLeaseToken({
      jobId: job.id,
      jobExecutionId: step.jobExecutionId,
      workflowRunId: run.id,
      workflowRunAttemptId: job.workflowRunAttemptId,
      projectId: run.projectId,
      workspaceId: run.workspaceId,
      runnerSessionId: crypto.randomUUID(),
    });

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('lease-not-active');
  });

  test('returns 404 when the step belongs to a different job', async () => {
    const {job: jobA} = await createRunningAgentStep();
    const {step: stepB} = await createRunningAgentStep();
    const token = await mintActiveLeaseToken({jobId: jobA.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(stepB.id, stepB.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('step-not-found');
  });

  test('returns 409 when the requested attempt is stale', async () => {
    const {job, step} = await createRunningAgentStep();
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt + 1),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('step-attempt-mismatch');
  });

  test.each([
    'pending',
    'succeeded',
    'failed',
    'cancelled',
  ] as const)('returns 409 when the step is %s', async (status) => {
    const {job, step} = await createRunningAgentStep({status});
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('step-not-running');
  });

  test('returns 409 when the step is not an agent step', async () => {
    const {job, step} = await createRunningRunStep();
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('step-not-agent');
  });

  test('returns 409 when the agent step config is malformed', async () => {
    const {job, step} = await createRunningAgentStep();
    await db()
      .update(stepsTable)
      .set({config: {provider: 'anthropic', model: 'claude-opus-4-8', prompt: 'missing thinking'}})
      .where(eq(stepsTable.id, step.id));
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('agent-step-config-invalid');
  });

  test('returns 409 when credentials are unavailable', async () => {
    const {job, step} = await createRunningAgentStep();
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('model-provider-not-configured');
  });

  test('returns 409 and reports when workspace credentials cannot be decrypted', async () => {
    const {job, step} = await createRunningAgentStep();
    vi.mocked(resolveRuntimeCredentials).mockRejectedValueOnce(new SecretDecryptionError());
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('model-provider-credentials-invalid');
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({name: 'SecretDecryptionError'}),
    );
    expect(JSON.stringify(res.json())).not.toContain('sk-');
  });

  test('does not write returned credential material to logs', async () => {
    const {run, job, step} = await createRunningAgentStep();
    const secret = 'sk-super-secret-runtime-credential';
    await saveWorkspaceCredential(run.workspaceId, secret);
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().credentials.api_key).toBe(secret);
    expect(logLines.join('\n')).not.toContain(secret);
  });
});

function runtimeConfigUrl(stepId: string, attempt: number): string {
  const search = new URLSearchParams({step_id: stepId, attempt: String(attempt)});
  return `${URL}?${search.toString()}`;
}

async function saveWorkspaceCredential(workspaceId: string, apiKey: string) {
  return await testAndSaveModelProviderConfig(
    {
      workspaceId,
      providerId: 'anthropic',
      credentials: {api_key: apiKey},
    },
    {probe: async () => undefined},
  );
}

type TestStepInput =
  | {
      name?: string;
      model?: string;
      provider?: string;
      thinking?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
      prompt: string;
      gate?: WorkflowModel['jobs'][number]['steps'][number]['gate'];
    }
  | {run: string};
type TestWorkflowExpression = NonNullable<
  NonNullable<WorkflowModel['jobs'][number]['steps'][number]['gate']>['successIf']
>;

function expression(source: string): TestWorkflowExpression {
  return {language: 'cel', check: 'typed', source: source as TestWorkflowExpression['source']};
}

async function createRunningAgentStep(
  options: {
    status?: StepStatus;
    steps?: readonly TestStepInput[];
    workspaceId?: string;
    resolveAgentDefaults?: Parameters<typeof createWorkflowRun>[0]['resolveAgentDefaults'];
  } = {},
) {
  return await createStep({
    steps: options.steps ?? [{prompt: 'Fix the failing tests.'}],
    targetType: 'agent',
    status: options.status ?? 'running',
    workspaceId: options.workspaceId,
    resolveAgentDefaults: options.resolveAgentDefaults,
  });
}

async function createRunningRunStep() {
  return await createStep({
    steps: [{run: 'echo hello'}],
    targetType: 'run',
    status: 'running',
  });
}

async function createStep(params: {
  steps: readonly TestStepInput[];
  targetType: 'agent' | 'run';
  status: StepStatus;
  workspaceId?: string | undefined;
  resolveAgentDefaults?: Parameters<typeof createWorkflowRun>[0]['resolveAgentDefaults'];
}) {
  const run = await createWorkflowRun({
    workspaceId: params.workspaceId ?? crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    definitionId: crypto.randomUUID(),
    model: workflowModel({jobs: {build: {steps: params.steps}}}),
    resolveAgentDefaults: params.resolveAgentDefaults,
    triggerPayload: {
      source: 'manual',
      event: 'fire',
      subscriptionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    },
  });
  const [job] = await getJobsByWorkflowRunId(run.id);
  if (!job) throw new Error('createStep: run created no job');
  await db().update(jobs).set({status: 'running'}).where(eq(jobs.id, job.id));

  const stepRows = await getStepsByJobId(job.id);
  const step = stepRows.find((candidate) => candidate.type === params.targetType);
  if (!step) throw new Error(`createStep: ${params.targetType} step not found`);
  await db().update(stepsTable).set({status: params.status}).where(eq(stepsTable.id, step.id));

  return {
    run,
    job: {...job, status: 'running' as const},
    step: {...step, status: params.status},
  };
}
