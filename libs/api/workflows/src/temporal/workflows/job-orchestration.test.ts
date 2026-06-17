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
  projectId: 'project-1',
  jobVersion: 1,
};

function executeJob(input: typeof defaultJobInput): Promise<{status: string; jobVersion: number}> {
  return testEnv.client.workflow.execute('jobOrchestration', {
    taskQueue: TASK_QUEUE,
    workflowId: `job:${input.jobId}`,
    args: [input],
  });
}

function finalStatusesFor(jobId: string): string[] {
  return setJobStatusCalls()
    .filter((c) => c.params.jobId === jobId)
    .map((c) => c.params.status);
}

describe('jobOrchestration', () => {
  test('finished signal (succeeded) flips status and releases the lease', async () => {
    setCfg({
      dag: makeDag([dagJob('job-1', 'build')]),
      jobResults: new Map([['job-1', 'succeeded']]),
    });

    const result = await executeJob(defaultJobInput);

    expect(result.status).toBe('succeeded');
    expect(finalStatusesFor('job-1')).toEqual(['running', 'succeeded']);
    expect(callsNamed('releaseLeaseActivity')).toHaveLength(1);
    expect(callsNamed('resolveLeaseExpiredJobActivity')).toHaveLength(0);
    expect(callsNamed('bulkSetStepStatuses')).toHaveLength(0);
  });

  test('finished signal (failed) flips status without sweeping steps', async () => {
    setCfg({dag: makeDag([dagJob('job-2', 'build')]), jobResults: new Map([['job-2', 'failed']])});

    const result = await executeJob({...defaultJobInput, jobId: 'job-2'});

    expect(result.status).toBe('failed');
    expect(finalStatusesFor('job-2')).toEqual(['running', 'failed']);
    expect(callsNamed('releaseLeaseActivity')).toHaveLength(1);
    expect(callsNamed('bulkSetStepStatuses')).toHaveLength(0);
  });

  test('lease-expired signal resolves via the activity and releases the lease', async () => {
    setCfg({
      dag: makeDag([]),
      jobResults: new Map(),
      signalLeaseExpired: true,
      leaseExpiredStatus: 'failed',
    });

    const result = await executeJob({...defaultJobInput, jobId: 'job-le'});

    expect(result.status).toBe('failed');
    expect(callsNamed('resolveLeaseExpiredJobActivity')).toHaveLength(1);
    expect(callsNamed('releaseLeaseActivity')).toHaveLength(1);
    expect(callsNamed('failJobAsTimedOutActivity')).toHaveLength(0);
  });

  test('lease-expired adoption: resolver reports succeeded → job succeeds (server state wins)', async () => {
    setCfg({
      dag: makeDag([]),
      jobResults: new Map(),
      signalLeaseExpired: true,
      leaseExpiredStatus: 'succeeded',
    });

    const result = await executeJob({...defaultJobInput, jobId: 'job-le2'});

    expect(result.status).toBe('succeeded');
    expect(callsNamed('resolveLeaseExpiredJobActivity')).toHaveLength(1);
  });

  test('both signals: finished wins, lease-expiry is ignored', async () => {
    setCfg({
      dag: makeDag([]),
      jobResults: new Map([['job-both', 'succeeded']]),
      signalBoth: true,
    });

    const result = await executeJob({...defaultJobInput, jobId: 'job-both'});

    expect(result.status).toBe('succeeded');
    expect(callsNamed('resolveLeaseExpiredJobActivity')).toHaveLength(0);
  });

  test('both signals with finished=failed: fails via the finished path, one terminal setJobStatus', async () => {
    setCfg({
      dag: makeDag([]),
      jobResults: new Map([['job-bf', 'failed']]),
      signalBoth: true,
    });

    const result = await executeJob({...defaultJobInput, jobId: 'job-bf'});

    expect(result.status).toBe('failed');
    expect(finalStatusesFor('job-bf').filter((s) => s !== 'running')).toEqual(['failed']);
    expect(callsNamed('resolveLeaseExpiredJobActivity')).toHaveLength(0);
  });

  test('duplicate finished signal: first wins', async () => {
    setCfg({
      dag: makeDag([]),
      jobResults: new Map([['job-dup', 'succeeded']]),
      duplicateSignal: true,
    });

    const result = await executeJob({...defaultJobInput, jobId: 'job-dup'});

    expect(result.status).toBe('succeeded');
    expect(finalStatusesFor('job-dup').filter((s) => s !== 'running')).toEqual(['succeeded']);
  });

  test('releaseLease failure does not block the result (best-effort)', async () => {
    setCfg({
      dag: makeDag([]),
      jobResults: new Map([['job-rl', 'succeeded']]),
      releaseLeaseError: 'runners db down',
    });

    const result = await executeJob({...defaultJobInput, jobId: 'job-rl'});

    expect(result.status).toBe('succeeded');
    expect(callsNamed('releaseLeaseActivity').length).toBeGreaterThanOrEqual(1);
  });

  test('no signal — workflow stays blocked indefinitely', async () => {
    setCfg({dag: makeDag([]), jobResults: new Map(), skipSignal: true});

    const handle = await testEnv.client.workflow.start('jobOrchestration', {
      taskQueue: TASK_QUEUE,
      workflowId: 'job:job-stuck',
      args: [{...defaultJobInput, jobId: 'job-stuck'}],
    });

    await new Promise((r) => setTimeout(r, 2000));

    const description = await handle.describe();
    expect(description.status.name).toBe('RUNNING');

    // Clean up: signal it so it completes and does not leak.
    setCfg({dag: makeDag([]), jobResults: new Map()});
    await handle.signal('job-finished', {status: 'failed'});
    await handle.result();
  }, 15_000);
});
