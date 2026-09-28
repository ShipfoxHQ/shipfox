import {Buffer} from 'node:buffer';
import {definitionsInterModuleContract} from '@shipfox/api-definitions-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {agentThinkingSchema, encodeActionBundle} from '@shipfox/workflow-document';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {jobs} from '#db/schema/jobs.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {createWorkflowRun, getJobsByWorkflowRunId, getStepsByJobId} from '#db/workflow-runs.js';
import {type TestWorkflowStep, workflowModel} from '#test/factories/workflow-model.js';
import {mintActiveLeaseToken} from '#test/fixtures/active-lease-token.js';
import {agentTestClient} from '#test/fixtures/agent-inter-module.js';
import {annotationsTestClient} from '#test/fixtures/annotations-inter-module.js';
import {workflowsTestAuthClient} from '#test/fixtures/auth-inter-module.js';
import {fakeLeaseTokenAuthMethod} from '#test/fixtures/lease-token.js';
import {projectsTestClient} from '#test/fixtures/projects-inter-module.js';
import {runnersTestClient} from '#test/fixtures/runners-inter-module.js';
import {createTestSecretsClient} from '#test/fixtures/secrets-inter-module.js';
import {createLeaseTokenRouteGroup} from './index.js';

describe('GET /runs/jobs/current/steps/:stepId/action-bundle', () => {
  let app: FastifyInstance;
  const snapshots = new Map<string, {workspaceId: string; gzip: Uint8Array}>();
  const getActionSnapshot = vi.fn(
    ({workspaceId, digest}: {workspaceId: string; digest: string}) => {
      const snapshot = snapshots.get(digest);
      if (snapshot === undefined || snapshot.workspaceId !== workspaceId) {
        return Promise.reject(
          createInterModuleKnownError(
            definitionsInterModuleContract.methods.getActionSnapshot,
            'action-snapshot-not-found',
            {digest},
          ),
        );
      }
      return Promise.resolve({
        manifest: {},
        bundleGzipBase64: Buffer.from(snapshot.gzip).toString('base64'),
        bytes: snapshot.gzip.byteLength,
      });
    },
  );

  beforeAll(async () => {
    app = await createApp({
      auth: [fakeLeaseTokenAuthMethod],
      routes: [
        createLeaseTokenRouteGroup({
          agent: agentTestClient,
          annotations: annotationsTestClient,
          auth: workflowsTestAuthClient,
          definitions: {getActionSnapshot} as never,
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

  beforeEach(() => {
    getActionSnapshot.mockClear();
  });

  afterAll(async () => {
    await closeApp();
  });

  test('returns the gzipped bundle named by the step config', async () => {
    const bundle = await encodeActionBundle({
      files: [{path: 'index.ts', content: 'export default {};'}],
    });
    const {run, job, step} = await createRunningStep({
      uses: './actions/hello',
      action: {digest: bundle.digest},
    });
    snapshots.set(bundle.digest, {workspaceId: run.workspaceId, gzip: bundle.gzip});
    const token = await mintStepToken({
      jobId: job.id,
      stepId: step.id,
      attempt: step.currentAttempt,
    });

    const res = await app.inject({
      method: 'GET',
      url: actionBundleUrl(step.id),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-type']).toBe('application/gzip');
    expect(res.rawPayload).toEqual(Buffer.from(bundle.gzip));
    expect(getActionSnapshot).toHaveBeenCalledWith({
      workspaceId: run.workspaceId,
      digest: bundle.digest,
    });
  });

  test('rejects a step that is not the current leased step', async () => {
    const {job, step} = await createRunningStep({uses: './actions/hello'});
    const token = await mintStepToken({
      jobId: job.id,
      stepId: crypto.randomUUID(),
      attempt: step.currentAttempt,
    });

    const res = await app.inject({
      method: 'GET',
      url: actionBundleUrl(step.id),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('step-not-current');
    expect(getActionSnapshot).not.toHaveBeenCalled();
  });

  test('rejects a leased step that is not an action step', async () => {
    const {job, step} = await createRunningStep({run: 'echo hello'});
    const token = await mintStepToken({
      jobId: job.id,
      stepId: step.id,
      attempt: step.currentAttempt,
    });

    const res = await app.inject({
      method: 'GET',
      url: actionBundleUrl(step.id),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('step-not-action');
    expect(getActionSnapshot).not.toHaveBeenCalled();
  });

  test('returns 404 when the snapshot is missing', async () => {
    const {job, step} = await createRunningStep({
      uses: './actions/hello',
      action: {digest: `sha256:${'a'.repeat(64)}`},
    });
    const token = await mintStepToken({
      jobId: job.id,
      stepId: step.id,
      attempt: step.currentAttempt,
    });

    const res = await app.inject({
      method: 'GET',
      url: actionBundleUrl(step.id),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('action-snapshot-not-found');
  });
});

function actionBundleUrl(stepId: string): string {
  return `/runs/jobs/current/steps/${stepId}/action-bundle`;
}

async function mintStepToken(params: {
  jobId: string;
  stepId: string;
  attempt: number;
}): Promise<string> {
  return await mintActiveLeaseToken({
    renewableInference: false,
    jobId: params.jobId,
    token: {currentStepId: params.stepId, currentStepAttempt: params.attempt},
  });
}

async function createRunningStep(target: TestWorkflowStep) {
  const run = await createWorkflowRun({
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    definitionId: crypto.randomUUID(),
    model: workflowModel({jobs: {build: {steps: [target]}}}),
    resolveAgentDefaults: (defaults) => ({
      harness: defaults.harness ?? 'pi',
      provider: defaults.provider ?? 'anthropic',
      model: defaults.model ?? 'claude-opus-4-8',
      thinking: agentThinkingSchema.safeParse(defaults.thinking).data ?? 'high',
    }),
    triggerPayload: {
      source: 'manual',
      event: 'fire',
      subscriptionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    },
  });
  const [job] = await getJobsByWorkflowRunId(run.id);
  if (!job) throw new Error('createRunningStep: run created no job');
  await db().update(jobs).set({status: 'running'}).where(eq(jobs.id, job.id));

  const stepRows = await getStepsByJobId(job.id);
  const step = stepRows.at(-1);
  if (!step) throw new Error('createRunningStep: run created no step');
  await db().update(stepsTable).set({status: 'running'}).where(eq(stepsTable.id, step.id));

  return {run, job, step: {...step, status: 'running' as const}};
}
