import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import {requireProjectAccess} from '@shipfox/api-projects';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {WorkflowRunNotFoundError} from '#core/errors.js';
import {getJobsByRunId, getWorkflowRunById, updateWorkflowRunStatus} from '#db/index.js';
import {createWorkflowRun} from '#db/workflow-runs.js';
import {workflowModel} from '#test/index.js';
import {cancelRunRoute} from './cancel-run.js';

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

describe('POST /api/workflows/runs/:id/cancel', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let projectId: string;
  let definitionId: string;

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
    app.post('/api/workflows/runs/:id/cancel', cancelRunRoute);
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    definitionId = crypto.randomUUID();
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

  test('returns 200 and cancels a running run', async () => {
    const run = await createRun();
    await updateWorkflowRunStatus({runId: run.id, status: 'running', expectedVersion: 1});

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${run.id}/cancel`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({id: run.id, status: 'cancelled'});
    expect(await getWorkflowRunById(run.id)).toMatchObject({status: 'cancelled'});
    const [job] = await getJobsByRunId(run.id);
    expect(job).toMatchObject({status: 'cancelled', statusReason: 'run_cancelled'});
  });

  test('returns 404 for an unknown run', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${crypto.randomUUID()}/cancel`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  test('maps a run disappearing during cancellation to 404', () => {
    let mapped: unknown;
    const errorHandler = cancelRunRoute.errorHandler as (error: Error) => void;

    try {
      errorHandler(new WorkflowRunNotFoundError(crypto.randomUUID()));
    } catch (error) {
      mapped = error;
    }

    expect(mapped).toBeInstanceOf(ClientError);
    expect(mapped).toMatchObject({status: 404, code: 'not-found'});
  });

  test('returns 404 when project access is denied', async () => {
    const run = await createRun();
    mockRequireProjectAccess.mockRejectedValueOnce(
      new ClientError('Forbidden', 'forbidden', {status: 403}),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${run.id}/cancel`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
    expect(await getWorkflowRunById(run.id)).toMatchObject({status: 'pending'});
  });

  test('returns 409 for a terminal run', async () => {
    const run = await createRun();
    await updateWorkflowRunStatus({runId: run.id, status: 'succeeded', expectedVersion: 1});

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${run.id}/cancel`,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('run-already-finished');
    expect(await getWorkflowRunById(run.id)).toMatchObject({status: 'succeeded'});
  });

  function createRun() {
    return createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: workflowModel({name: 'Deploy'}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
  }
});
