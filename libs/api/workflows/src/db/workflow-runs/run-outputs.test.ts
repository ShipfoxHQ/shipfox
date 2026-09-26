import {eq} from 'drizzle-orm';
import {MAX_JOB_OUTPUT_VALUE_BYTES} from '#core/step-config/job-output-limits.js';
import {listTestRunAttempts} from '#test/helpers/run-attempts.js';
import {
  buildModel,
  jobByKey,
  runTerminatedEvents,
  type TestWorkflowModelInput,
  template,
} from '#test/helpers/workflow-runs.js';
import {db} from '../db.js';
import {jobs} from '../schema/jobs.js';
import {
  createRerunWorkflowRun,
  createWorkflowRun,
  getLifecycleEventContextRead,
  updateWorkflowRunStatus,
} from '../workflow-runs.js';

describe('workflow run outputs', () => {
  let workspaceId: string;
  let projectId: string;
  let definitionId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    definitionId = crypto.randomUUID();
  });

  function createRun(model: TestWorkflowModelInput) {
    return createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: buildModel(model),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
      inputs: {env: 'staging'},
      secrets: {getVariablesByNamespace: vi.fn().mockResolvedValue({values: {REGION: 'eu'}})},
    });
  }

  async function settleJob(
    workflowRunId: string,
    key: string,
    status: 'succeeded' | 'failed' | 'skipped',
    outputs: Record<string, unknown> | null = null,
  ) {
    const job = await jobByKey(workflowRunId, key);
    await db().update(jobs).set({status, outputs}).where(eq(jobs.id, job.id));
  }

  async function currentAttempt(workflowRunId: string) {
    const attempts = await listTestRunAttempts({workflowRunId, projectId});
    const attempt = attempts.at(-1);
    if (!attempt) throw new Error(`Missing attempt for run ${workflowRunId}`);
    return attempt;
  }

  async function succeed(workflowRunId: string) {
    const attempt = await currentAttempt(workflowRunId);
    return updateWorkflowRunStatus({
      workflowRunAttemptId: attempt.id,
      status: 'succeeded',
      expectedVersion: attempt.version,
    });
  }

  test('commits materialized outputs with the succeeded status and event', async () => {
    const run = await createRun({
      jobs: {build: {steps: [{run: 'echo build'}]}},
      outputs: {
        version: template('jobs.build.outputs.version'),
        target: `${template('inputs.env')}-${template('vars.REGION')}`,
        attempt: template('run.attempt'),
      },
      outputTypes: {attempt: 'int'},
    });
    await settleJob(run.id, 'build', 'succeeded', {version: '1.2.3'});

    const updated = await succeed(run.id);

    const attempt = await currentAttempt(run.id);
    expect(updated.status).toBe('succeeded');
    expect(attempt).toMatchObject({
      status: 'succeeded',
      statusReason: null,
      outputs: {version: '1.2.3', target: 'staging-eu', attempt: 1},
    });
    expect(await runTerminatedEvents(run.id)).toEqual([
      expect.objectContaining({status: 'succeeded', statusReason: null}),
    ]);
    expect(
      await getLifecycleEventContextRead({workspaceId, workflowRunAttemptId: attempt.id}),
    ).toMatchObject({outputs: {version: '1.2.3', target: 'staging-eu', attempt: 1}});
  });

  test('keeps outputs null when the workflow declares none', async () => {
    const run = await createRun({jobs: {build: {steps: [{run: 'echo build'}]}}});
    await settleJob(run.id, 'build', 'succeeded', {version: '1.2.3'});

    await succeed(run.id);

    expect(await currentAttempt(run.id)).toMatchObject({status: 'succeeded', outputs: null});
  });

  test('fails the attempt when an output expression cannot be resolved', async () => {
    const run = await createRun({
      jobs: {build: {steps: [{run: 'echo build'}]}},
      outputs: {version: template('jobs.build.outputs.missing')},
    });
    await settleJob(run.id, 'build', 'succeeded', {version: '1.2.3'});

    const updated = await succeed(run.id);

    expect(updated.status).toBe('failed');
    expect(await currentAttempt(run.id)).toMatchObject({
      status: 'failed',
      statusReason: 'output_invalid',
      statusReasonMessage: expect.stringContaining(
        'workflow.outputs (version) uses `jobs.build.outputs.missing`',
      ),
      outputs: null,
    });
    expect(await runTerminatedEvents(run.id)).toEqual([
      expect.objectContaining({status: 'failed', statusReason: 'output_invalid'}),
    ]);
  });

  test('fails the attempt when an output value exceeds the size limit', async () => {
    const run = await createRun({
      jobs: {build: {steps: [{run: 'echo build'}]}},
      outputs: {blob: template('jobs.build.outputs.blob')},
    });
    await settleJob(run.id, 'build', 'succeeded', {
      blob: 'x'.repeat(MAX_JOB_OUTPUT_VALUE_BYTES + 1),
    });

    const updated = await succeed(run.id);

    expect(updated.status).toBe('failed');
    expect(await currentAttempt(run.id)).toMatchObject({
      status: 'failed',
      statusReason: 'output_too_large',
      statusReasonMessage: expect.stringContaining('Workflow output "blob" exceeds'),
      outputs: null,
    });
    expect(await runTerminatedEvents(run.id)).toEqual([
      expect.objectContaining({status: 'failed', statusReason: 'output_too_large'}),
    ]);
  });

  test('fails the attempt when an output references a skipped job output', async () => {
    const run = await createRun({
      jobs: {
        build: {steps: [{run: 'echo build'}]},
        publish: {steps: [{run: 'echo publish'}]},
      },
      outputs: {published: template('jobs.publish.outputs.version')},
    });
    await settleJob(run.id, 'build', 'succeeded');
    await settleJob(run.id, 'publish', 'skipped');

    await succeed(run.id);

    expect(await currentAttempt(run.id)).toMatchObject({
      status: 'failed',
      statusReason: 'output_invalid',
      statusReasonMessage: expect.stringContaining('workflow.outputs (published)'),
    });
  });

  test('exposes empty outputs for a skipped job to guarded references', async () => {
    const run = await createRun({
      jobs: {
        build: {steps: [{run: 'echo build'}]},
        publish: {steps: [{run: 'echo publish'}]},
      },
      outputs: {
        published: template(
          "has(jobs.publish.outputs.version) ? jobs.publish.outputs.version : 'none'",
        ),
        status: template('jobs.publish.status'),
      },
    });
    await settleJob(run.id, 'build', 'succeeded');
    await settleJob(run.id, 'publish', 'skipped');

    await succeed(run.id);

    expect(await currentAttempt(run.id)).toMatchObject({
      status: 'succeeded',
      outputs: {published: 'none', status: 'skipped'},
    });
  });

  test('materializes rerun outputs from a carried-over job', async () => {
    const run = await createRun({
      jobs: {
        build: {steps: [{run: 'echo build'}]},
        deploy: {needs: 'build', steps: [{run: 'echo deploy'}]},
      },
      outputs: {
        version: template('jobs.build.outputs.version'),
        url: template('jobs.deploy.outputs.url'),
        attempt: template('run.attempt'),
      },
    });
    await settleJob(run.id, 'build', 'succeeded', {version: '1.2.3'});
    await settleJob(run.id, 'deploy', 'failed');
    await updateWorkflowRunStatus({
      workflowRunId: run.id,
      status: 'failed',
      statusReason: 'job_failed',
      expectedVersion: 1,
    });

    await createRerunWorkflowRun({
      workflowRunId: run.id,
      mode: 'failed',
      actorUserId: crypto.randomUUID(),
    });
    expect(await jobByKey(run.id, 'build')).toMatchObject({
      carriedOver: true,
      outputs: {version: '1.2.3'},
    });
    await settleJob(run.id, 'deploy', 'succeeded', {url: 'https://staging.example.com'});

    await succeed(run.id);

    const attempts = await listTestRunAttempts({workflowRunId: run.id, projectId});
    expect(attempts).toMatchObject([
      {attempt: 1, status: 'failed', outputs: null},
      {
        attempt: 2,
        status: 'succeeded',
        outputs: {version: '1.2.3', url: 'https://staging.example.com', attempt: '2'},
      },
    ]);
  });
});
