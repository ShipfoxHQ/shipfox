import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import {requireProjectAccess} from '@shipfox/api-projects';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {
  createWorkflowRun,
  getJobsByWorkflowRunId,
  updateJobStatus,
  updateWorkflowRunStatus,
} from '#db/workflow-runs.js';
import {workflowModel} from '#test/index.js';
import {rerunRunRoute} from './rerun-run.js';

const projectAccessState = vi.hoisted(() => ({workspaceId: ''}));

vi.mock('@shipfox/api-projects', () => ({
  requireProjectAccess: vi.fn(({projectId}) =>
    Promise.resolve({
      project: {id: projectId, workspaceId: projectAccessState.workspaceId},
      workspaceId: projectAccessState.workspaceId,
    }),
  ),
}));

const mockRequireProjectAccess = vi.mocked(requireProjectAccess);

describe('POST /api/workflows/runs/:id/rerun', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let projectId: string;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.addHook('onRequest', (request, _reply, done) => {
      setUserContext(
        request,
        buildUserContext({
          userId: crypto.randomUUID(),
          email: 'user@example.com',
          memberships: [{workspaceId, role: 'admin'}],
        }),
      );
      done();
    });
    app.post('/api/workflows/runs/:id/rerun', rerunRunRoute);
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    projectAccessState.workspaceId = workspaceId;
    mockRequireProjectAccess.mockImplementation(({projectId: requestedProjectId}) =>
      Promise.resolve({
        project: {
          id: requestedProjectId,
          workspaceId,
          sourceConnectionId: crypto.randomUUID(),
          sourceExternalRepositoryId: `repo:${crypto.randomUUID()}`,
          name: 'Project',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        workspaceId,
      }),
    );
  });

  async function createTerminalRun(status: 'succeeded' | 'failed' = 'failed') {
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      model: workflowModel({jobs: {build: {steps: [{run: 'echo build'}]}}}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    return updateWorkflowRunStatus({workflowRunId: run.id, status, expectedVersion: run.version});
  }

  async function createFailedRunWithFailedJob() {
    const run = await createTerminalRun('failed');
    const [job] = await getJobsByWorkflowRunId(run.id);
    if (!job) throw new Error('Expected workflow job');
    await updateJobStatus({jobId: job.id, status: 'failed', expectedVersion: job.version});
    return run;
  }

  test('creates a new attempt for all mode', async () => {
    const source = await createTerminalRun('failed');

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${source.id}/rerun`,
      payload: {mode: 'all'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: source.id,
      current_attempt: 2,
      latest_attempt: 2,
      status: 'pending',
    });
  });

  test('creates a new attempt for failed mode', async () => {
    const source = await createFailedRunWithFailedJob();

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${source.id}/rerun`,
      payload: {mode: 'failed'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: source.id,
      current_attempt: 2,
      latest_attempt: 2,
      status: 'pending',
    });
  });

  test('returns 409 when failed mode has no failed or cancelled jobs', async () => {
    const source = await createTerminalRun('succeeded');

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${source.id}/rerun`,
      payload: {mode: 'failed'},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('no-failed-jobs');
  });

  test('returns 409 when the source run is not terminal', async () => {
    const source = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      model: workflowModel(),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${source.id}/rerun`,
      payload: {mode: 'all'},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('run-not-terminal');
  });

  test('returns 404 for a missing or inaccessible source run', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${crypto.randomUUID()}/rerun`,
      payload: {mode: 'all'},
    });
    const source = await createTerminalRun('failed');
    mockRequireProjectAccess.mockRejectedValueOnce(
      new ClientError('Forbidden', 'forbidden', {status: 403}),
    );

    const inaccessible = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${source.id}/rerun`,
      payload: {mode: 'all'},
    });

    expect(missing.statusCode).toBe(404);
    expect(inaccessible.statusCode).toBe(404);
  });

  test('returns 400 for an invalid mode', async () => {
    const source = await createTerminalRun('failed');

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${source.id}/rerun`,
      payload: {mode: 'everything'},
    });

    expect(res.statusCode).toBe(400);
  });
});
