import {
  e2eWorkflowRunPageFixtureResponseSchema,
  type RunDetailResponseDto,
} from '@shipfox/api-workflows-dto';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {createE2eWorkflowRunPageFixtureRoute} from './create-run-page-fixture.js';

function stepsFor(
  run: RunDetailResponseDto,
): Array<RunDetailResponseDto['jobs'][number]['steps'][number]> {
  return run.jobs.flatMap((job) => job.steps);
}

describe('POST /__e2e/workflows/run-page-fixture', () => {
  it('creates canonical succeeded, failed, and running run DTOs from real persisted workflow data', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.post('/__e2e/workflows/run-page-fixture', createE2eWorkflowRunPageFixtureRoute);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/__e2e/workflows/run-page-fixture',
      payload: {
        workspace_id: crypto.randomUUID(),
        project_name: 'Workflow Run Page E2E Fixture',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = e2eWorkflowRunPageFixtureResponseSchema.parse(res.json());
    expect(body.project.name).toBe('Workflow Run Page E2E Fixture');
    expect(body.run_list.runs).toHaveLength(3);
    expect(body.run_list.filtered_total_count).toBe(3);
    expect(body.run_list.next_cursor).toBeNull();
    expect(body.run_list.runs.map((run) => run.status)).toEqual(['running', 'failed', 'succeeded']);
    expect(body.runs.succeeded.status).toBe('succeeded');
    expect(body.runs.succeeded.jobs.map((job) => job.status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    expect(stepsFor(body.runs.succeeded).every((step) => step.status === 'succeeded')).toBe(true);
    expect(stepsFor(body.runs.succeeded).every((step) => step.attempts.length === 1)).toBe(true);
    expect(body.runs.succeeded.jobs.map((job) => job.dependencies)).toEqual([
      [],
      ['Build'],
      ['Test'],
    ]);

    expect(body.runs.failed.status).toBe('failed');
    expect(body.runs.failed.jobs.map((job) => job.status)).toEqual([
      'succeeded',
      'failed',
      'cancelled',
    ]);
    const failedSteps = stepsFor(body.runs.failed);
    expect(failedSteps.some((step) => step.status === 'failed')).toBe(true);
    expect(body.runs.failed.jobs.some((job) => job.status === 'cancelled')).toBe(true);
    expect(failedSteps.find((step) => step.status === 'failed')?.error).toEqual({
      message: 'Browser smoke failed on checkout summary',
      exit_code: 1,
      category: 'user',
    });

    expect(body.runs.running.status).toBe('running');
    expect(body.runs.running.jobs.map((job) => job.status)).toEqual([
      'succeeded',
      'running',
      'pending',
    ]);
    const runningSteps = stepsFor(body.runs.running);
    expect(runningSteps.filter((step) => step.status === 'running')).toHaveLength(1);
    expect(runningSteps.find((step) => step.status === 'running')?.attempts).toEqual([
      expect.objectContaining({status: 'running', finished_at: null}),
    ]);
    expect(body.deferred.gated_restart).toBe('typed-gate-restart-contract-not-on-main');
  });
});
