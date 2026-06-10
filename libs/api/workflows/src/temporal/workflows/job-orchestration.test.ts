import {
  callsNamed,
  dagJob,
  makeDag,
  resetCalls,
  setCfg,
  setJobStatusCalls,
  setupEnv,
  TASK_QUEUE,
  teardownEnv,
  testEnv,
} from './test-env.js';

beforeAll(async () => {
  await setupEnv();
}, 60_000);

afterAll(async () => {
  await teardownEnv();
}, 15_000);

beforeEach(() => {
  resetCalls();
});

const defaultJobInput = {
  workspaceId: 'workspace-1',
  jobId: 'job-1',
  runId: 'run-1',
  jobVersion: 1,
};

function executeJob(input: typeof defaultJobInput): Promise<{status: string; jobVersion: number}> {
  return testEnv.client.workflow.execute('jobOrchestration', {
    taskQueue: TASK_QUEUE,
    workflowId: `job:${input.jobId}`,
    args: [input],
  });
}

describe('jobOrchestration', () => {
  test('signal succeeded — workflow flips the job status without re-applying step results', async () => {
    setCfg({dag: makeDag([]), jobResults: new Map([['job-1', 'succeeded']])});

    const result = await executeJob(defaultJobInput);

    expect(result.status).toBe('succeeded');
    expect(result.jobVersion).toBeGreaterThan(0);

    const statuses = setJobStatusCalls().map((c) => c.params.status);
    expect(statuses).toEqual(['running', 'succeeded']);

    // Per-step execution already persisted every step result (the same
    // transaction that enqueued the completion signal), so the completion path
    // only flips the job status — it neither re-applies nor bulk-writes steps.
    expect(callsNamed('applyStepResultsActivity')).toHaveLength(0);
    expect(callsNamed('bulkSetStepStatuses')).toHaveLength(0);
  });

  test('signal failed — workflow flips the job status without re-applying step results', async () => {
    setCfg({dag: makeDag([]), jobResults: new Map([['job-2', 'failed']])});

    const result = await executeJob({...defaultJobInput, jobId: 'job-2'});

    expect(result.status).toBe('failed');

    const statuses = setJobStatusCalls().map((c) => c.params.status);
    expect(statuses).toEqual(['running', 'failed']);

    expect(callsNamed('applyStepResultsActivity')).toHaveLength(0);
    expect(callsNamed('bulkSetStepStatuses')).toHaveLength(0);
  });

  test('duplicate signal is ignored', async () => {
    setCfg({
      dag: makeDag([dagJob('job-3', 'build')]),
      jobResults: new Map([['job-3', 'succeeded']]),
      duplicateSignal: true,
    });

    const result = await executeJob({...defaultJobInput, jobId: 'job-3'});

    // First signal wins.
    expect(result.status).toBe('succeeded');

    const finalStatuses = setJobStatusCalls()
      .map((c) => c.params.status)
      .filter((s) => s !== 'running');
    expect(finalStatuses).toEqual(['succeeded']);
  });

  test('no signal — workflow stays blocked indefinitely', async () => {
    setCfg({dag: makeDag([]), jobResults: new Map(), skipSignal: true});

    const handle = await testEnv.client.workflow.start('jobOrchestration', {
      taskQueue: TASK_QUEUE,
      workflowId: 'job:job-stuck',
      args: [{...defaultJobInput, jobId: 'job-stuck'}],
    });

    // Give the workflow time to reach condition().
    await new Promise((r) => setTimeout(r, 2000));

    const description = await handle.describe();
    expect(description.status.name).toBe('RUNNING');

    // Clean up: signal it so it completes and does not leak.
    setCfg({dag: makeDag([]), jobResults: new Map()});
    await handle.signal('job-completed', {status: 'failed', steps: []});
    await handle.result();
  }, 15_000);
});
