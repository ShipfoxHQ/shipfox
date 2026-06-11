import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import {requireProjectAccess} from '@shipfox/api-projects';
import {ClientError} from '@shipfox/node-fastify';
import {eq} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {nextStepForJob, recordStepResult} from '#core/job-execution.js';
import {db} from '#db/db.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {
  applyStepResults,
  createWorkflowRun,
  getJobsByRunId,
  getStepsByJobId,
} from '#db/workflow-runs.js';
import {workflowModel} from '#test/index.js';
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
      model: workflowModel({
        name: 'Test',
        jobs: {
          build: {steps: [{name: 'Install', run: 'npm install'}, {run: 'npm build'}]},
        },
      }),
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
      model: workflowModel({
        name: 'Test',
        jobs: {build: {steps: [{run: 'a'}, {run: 'b'}, {run: 'c'}]}},
      }),
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
      model: workflowModel({name: 'Test'}),
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
      model: workflowModel({name: 'Test'}),
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

  test('exposes step current_attempt and attempt history', async () => {
    const projectId = crypto.randomUUID();
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      model: workflowModel({
        name: 'Test',
        jobs: {build: {steps: [{run: 'a'}, {run: 'b'}]}},
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const jobId = (await getJobsByRunId(run.id))[0]?.id as string;
    const steps = await getStepsByJobId(jobId);
    await nextStepForJob(jobId);
    await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'succeeded',
      exitCode: 0,
    });

    const res = await app.inject({method: 'GET', url: `/api/workflows/runs/${run.id}`});

    expect(res.statusCode).toBe(200);
    const [step0, step1] = res.json().jobs[0].steps;
    expect(step0.current_attempt).toBe(1);
    expect(step0.attempts).toHaveLength(1);
    expect(step0.attempts[0]).toMatchObject({attempt: 1, status: 'succeeded', exit_code: 0});
    // A never-dispatched step has no attempt history yet.
    expect(step1.current_attempt).toBe(1);
    expect(step1.attempts).toEqual([]);
  });

  test('exposes multiple ordered attempts for a restarted step', async () => {
    const projectId = crypto.randomUUID();
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      model: workflowModel({
        name: 'Test',
        jobs: {build: {steps: [{run: 'produce'}, {run: 'review'}]}},
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const jobId = (await getJobsByRunId(run.id))[0]?.id as string;
    const steps = await getStepsByJobId(jobId);
    const producerId = steps[0]?.id as string;
    const reviewerId = steps[1]?.id as string;
    // reviewer gate: succeed only on exit 0; otherwise restart from producer.
    await db().update(stepsTable).set({name: 'producer'}).where(eq(stepsTable.id, producerId));
    await db()
      .update(stepsTable)
      .set({
        config: {
          run: 'review',
          gate: {
            success_if: {language: 'cel', check: 'syntax', source: 'exit_code == 0'},
            on_failure: {restart_from: 'producer'},
          },
        },
      })
      .where(eq(stepsTable.id, reviewerId));
    const runStep = async (stepId: string, exitCode: number) => {
      await nextStepForJob(jobId);
      await recordStepResult({
        jobId,
        stepId,
        status: exitCode === 0 ? 'succeeded' : 'failed',
        ...(exitCode === 0 ? {} : {error: {message: `exit ${exitCode}`}}),
        exitCode,
      });
    };
    await runStep(producerId, 0); // producer attempt 1 succeeds
    await runStep(reviewerId, 1); // reviewer attempt 1 gate-fails → restart, both bumped to 2
    await runStep(producerId, 0); // producer attempt 2 succeeds
    await runStep(reviewerId, 0); // reviewer attempt 2 gate-passes → job done

    const res = await app.inject({method: 'GET', url: `/api/workflows/runs/${run.id}`});

    expect(res.statusCode).toBe(200);
    const [producer, reviewer] = res.json().jobs[0].steps;
    expect(producer.current_attempt).toBe(2);
    expect(producer.attempts.map((a: {attempt: number}) => a.attempt)).toEqual([1, 2]);
    expect(reviewer.current_attempt).toBe(2);
    const reviewerAttempts = reviewer.attempts as Array<{
      attempt: number;
      status: string;
      exit_code: number | null;
      gate_result: unknown;
      restart_reason: string | null;
    }>;
    expect(reviewerAttempts.map((a) => a.attempt)).toEqual([1, 2]); // ordered by attempt
    expect(reviewerAttempts[0]?.status).toBe('failed');
    expect(reviewerAttempts[0]?.exit_code).toBe(1);
    expect(reviewerAttempts[0]?.gate_result).toMatchObject({passed: false});
    expect(reviewerAttempts[0]?.restart_reason).toBeTruthy();
    expect(reviewerAttempts[1]?.status).toBe('succeeded');
    expect(reviewerAttempts[1]?.exit_code).toBe(0);
  });
});
