import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import {requireProjectAccess} from '@shipfox/api-projects';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {
  applyStepResults,
  createWorkflowRun,
  getJobsByRunId,
  getStepsByJobId,
} from '#db/workflow-runs.js';
import {getRunRoute} from './get-run.js';

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

describe('GET /api/workflows/runs/:id', () => {
  let app: FastifyInstance;
  let workspaceId: string;

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
    app.get('/api/workflows/runs/:id', getRunRoute);
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectAccessState.workspaceId = workspaceId;
    mockRequireProjectAccess.mockImplementation(({projectId}) =>
      Promise.resolve({
        project: {
          id: projectId,
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

  test('returns 200 with run, jobs, and steps', async () => {
    const projectId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();

    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      definition: {
        name: 'Test',
        jobs: {
          build: {steps: [{name: 'Install', run: 'npm install'}, {run: 'npm build'}]},
        },
      },
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(run.id);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].name).toBe('build');
    expect(body.jobs[0].steps).toHaveLength(2);
    expect(body.jobs[0].steps[0].name).toBe('Install');
    expect(body.jobs[0].steps[1].name).toBeNull();
  });

  test('exposes per-step error and cancelled status after applyStepResults', async () => {
    const projectId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();

    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      definition: {
        name: 'Test',
        jobs: {build: {steps: [{run: 'a'}, {run: 'b'}, {run: 'c'}]}},
      },
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });

    const runJobs = await getJobsByRunId(run.id);
    const jobId = runJobs[0]?.id ?? '';
    const steps = await getStepsByJobId(jobId);

    await applyStepResults({
      jobId,
      completionStatus: 'failed',
      reportedSteps: [
        {stepId: steps[0]?.id as string, status: 'succeeded', error: null},
        {
          stepId: steps[1]?.id as string,
          status: 'failed',
          error: {message: 'Command exited with code 1', exitCode: 1},
        },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const responseSteps = body.jobs[0].steps as Array<{
      status: string;
      error: {message: string; exit_code?: number | null} | null;
    }>;
    expect(responseSteps[0]?.status).toBe('succeeded');
    expect(responseSteps[0]?.error).toBeNull();
    expect(responseSteps[1]?.status).toBe('failed');
    expect(responseSteps[1]?.error).toEqual({
      message: 'Command exited with code 1',
      exit_code: 1,
    });
    expect(responseSteps[2]?.status).toBe('cancelled');
    expect(responseSteps[2]?.error).toBeNull();
  });

  test('returns 404 for non-existent run', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${crypto.randomUUID()}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  test('returns 404 for inaccessible run', async () => {
    const run = await createWorkflowRun({
      workspaceId,
      projectId: crypto.randomUUID(),
      definitionId: crypto.randomUUID(),
      definition: {name: 'Test', jobs: {build: {steps: [{run: 'echo'}]}}},
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    mockRequireProjectAccess.mockRejectedValueOnce(
      new ClientError('Not a member of this workspace', 'forbidden', {status: 403}),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  test('propagates unexpected errors from project access check', async () => {
    const run = await createWorkflowRun({
      workspaceId,
      projectId: crypto.randomUUID(),
      definitionId: crypto.randomUUID(),
      definition: {name: 'Test', jobs: {build: {steps: [{run: 'echo'}]}}},
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    mockRequireProjectAccess.mockRejectedValueOnce(new Error('database connection lost'));

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}`,
    });

    expect(res.statusCode).toBe(500);
  });
});
