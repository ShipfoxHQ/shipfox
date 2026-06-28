import {randomUUID} from 'node:crypto';
import {
  callsNamed,
  dagJob,
  makeDag,
  resetCalls,
  setCfg,
  setJobStatusCalls,
  setRunStatusCalls,
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

let runId: string;
let workspaceId: string;

beforeEach(() => {
  resetCalls();
  runId = `run-${randomUUID()}`;
  workspaceId = `workspace-${randomUUID()}`;
});

async function executeRun(): Promise<void> {
  await testEnv.client.workflow.execute('runOrchestration', {
    taskQueue: TASK_QUEUE,
    workflowId: `run:${runId}`,
    args: [{runId, workspaceId}],
  });
}

async function waitForActivity(name: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (callsNamed(name).length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${name}`);
}

describe('runOrchestration', () => {
  test('all-pending linear DAG enqueues every job and succeeds', async () => {
    const jobs = [
      dagJob('j1', 'build'),
      dagJob('j2', 'test', ['build']),
      dagJob('j3', 'deploy', ['test']),
    ];
    setCfg({dag: makeDag(jobs, 'r1'), jobResults: new Map()});

    await executeRun();

    const runStatuses = setRunStatusCalls().map((c) => c.params.status);
    expect(runStatuses).toEqual(['running', 'succeeded']);
    const enqueueCalls = callsNamed('enqueueJobForRunner');
    expect(enqueueCalls).toHaveLength(3);
    // The lease tuple is sourced from the loaded dag (workspace/project/run together).
    for (const call of enqueueCalls) {
      expect(call.params).toMatchObject({
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        runId: 'r1',
        requiredLabels: ['ubuntu22'],
      });
    }
  });

  test('already-succeeded upstream jobs are not re-enqueued', async () => {
    const jobs = [
      dagJob('j1', 'build', [], {status: 'succeeded'}),
      dagJob('j2', 'test', ['build']),
    ];
    setCfg({dag: makeDag(jobs, 'r1-carried'), jobResults: new Map([['j2', 'succeeded']])});

    await executeRun();

    const runStatuses = setRunStatusCalls().map((c) => c.params.status);
    expect(runStatuses).toEqual(['running', 'succeeded']);
    const enqueueCalls = callsNamed('enqueueJobForRunner');
    expect(enqueueCalls).toHaveLength(1);
    expect(enqueueCalls[0]?.params).toMatchObject({jobId: 'j2'});
  });

  test('already-succeeded upstream jobs can unblock a failed retry', async () => {
    const jobs = [
      dagJob('j1', 'build', [], {status: 'succeeded'}),
      dagJob('j2', 'test', ['build']),
    ];
    setCfg({dag: makeDag(jobs, 'r1-carried-failed'), jobResults: new Map([['j2', 'failed']])});

    await executeRun();

    const runStatuses = setRunStatusCalls().map((c) => c.params.status);
    expect(runStatuses).toEqual(['running', 'failed']);
    const enqueueCalls = callsNamed('enqueueJobForRunner');
    expect(enqueueCalls).toHaveLength(1);
    expect(enqueueCalls[0]?.params).toMatchObject({jobId: 'j2'});
  });

  test('parallel roots both succeed', async () => {
    const jobs = [
      dagJob('j1', 'lint'),
      dagJob('j2', 'test'),
      dagJob('j3', 'deploy', ['lint', 'test']),
    ];
    setCfg({dag: makeDag(jobs, 'r2'), jobResults: new Map()});

    await executeRun();

    const runStatuses = setRunStatusCalls().map((c) => c.params.status);
    expect(runStatuses).toEqual(['running', 'succeeded']);
    expect(callsNamed('enqueueJobForRunner')).toHaveLength(3);
  });

  test('single job fails, dependents are skipped', async () => {
    const jobs = [
      dagJob('j1', 'build'),
      dagJob('j2', 'test', ['build']),
      dagJob('j3', 'deploy', ['test']),
    ];
    setCfg({dag: makeDag(jobs, 'r3'), jobResults: new Map([['j1', 'failed']])});

    await executeRun();

    const runStatuses = setRunStatusCalls().map((c) => c.params.status);
    expect(runStatuses).toEqual(['running', 'failed']);

    expect(callsNamed('enqueueJobForRunner')).toHaveLength(1);
    const jobStatuses = setJobStatusCalls().map((c) => ({
      id: c.params.jobId,
      status: c.params.status,
      statusReason: c.params.statusReason ?? null,
    }));
    expect(jobStatuses).toContainEqual({
      id: 'j2',
      status: 'skipped',
      statusReason: 'dependency_not_completed',
    });
    expect(jobStatuses).toContainEqual({
      id: 'j3',
      status: 'skipped',
      statusReason: 'dependency_not_completed',
    });
  });

  test('first job fails, all downstream skipped', async () => {
    const jobs = [
      dagJob('j1', 'build'),
      dagJob('j2', 'a', ['build']),
      dagJob('j3', 'b', ['build']),
    ];
    setCfg({dag: makeDag(jobs, 'r4'), jobResults: new Map([['j1', 'failed']])});

    await executeRun();

    const runStatuses = setRunStatusCalls().map((c) => c.params.status);
    expect(runStatuses).toEqual(['running', 'failed']);
    expect(callsNamed('enqueueJobForRunner')).toHaveLength(1);

    const jobStatuses = setJobStatusCalls().map((c) => ({
      id: c.params.jobId,
      status: c.params.status,
      statusReason: c.params.statusReason ?? null,
    }));
    expect(jobStatuses).toContainEqual({
      id: 'j2',
      status: 'skipped',
      statusReason: 'dependency_not_completed',
    });
    expect(jobStatuses).toContainEqual({
      id: 'j3',
      status: 'skipped',
      statusReason: 'dependency_not_completed',
    });
  });

  test('version tracking flows through correctly', async () => {
    const jobs = [dagJob('j1', 'build')];
    setCfg({dag: makeDag(jobs, 'r5'), jobResults: new Map()});

    await executeRun();

    // The final setRunStatus should use the version returned by the first setRunStatus
    const finalRunStatus = setRunStatusCalls().at(-1);
    expect(finalRunStatus?.params.version).toBeGreaterThan(0);
  });

  test('cancel signal stops scheduling and fans out runner cancellation', async () => {
    const jobs = [dagJob('j1', 'build'), dagJob('j2', 'deploy', ['build'])];
    setCfg({dag: makeDag(jobs, 'r-cancel'), jobResults: new Map(), skipSignal: true});

    const handle = await testEnv.client.workflow.start('runOrchestration', {
      taskQueue: TASK_QUEUE,
      workflowId: `run:${runId}`,
      args: [{runId, workspaceId}],
    });
    await waitForActivity('enqueueJobForRunner');

    await handle.signal('run-cancel');
    await handle.result();

    expect(setRunStatusCalls().map((c) => c.params.status)).toEqual(['running']);
    expect(callsNamed('enqueueJobForRunner')).toHaveLength(1);
    expect(callsNamed('cancelRunnerJobsActivity')).toEqual([
      {name: 'cancelRunnerJobsActivity', params: {jobIds: ['j1', 'j2']}},
    ]);
  });

  test('aborts early when the initial running write reports an already-terminal run', async () => {
    const jobs = [dagJob('j1', 'build')];
    setCfg({
      dag: makeDag(jobs, 'r-terminal'),
      jobResults: new Map(),
      initialRunStatus: 'cancelled',
    });

    await executeRun();

    expect(setRunStatusCalls().map((c) => c.params.status)).toEqual(['running']);
    expect(callsNamed('enqueueJobForRunner')).toHaveLength(0);
    expect(callsNamed('cancelRunnerJobsActivity')).toHaveLength(0);
  });

  test('diamond DAG with partial failure', async () => {
    const jobs = [
      dagJob('j1', 'A'),
      dagJob('j2', 'B', ['A']),
      dagJob('j3', 'C', ['A']),
      dagJob('j4', 'D', ['B', 'C']),
    ];
    setCfg({dag: makeDag(jobs, 'r6'), jobResults: new Map([['j2', 'failed']])});

    await executeRun();

    const runStatuses = setRunStatusCalls().map((c) => c.params.status);
    expect(runStatuses).toEqual(['running', 'failed']);

    // A, B, C enqueued — D skipped because B failed
    expect(callsNamed('enqueueJobForRunner')).toHaveLength(3);
    const jobStatuses = setJobStatusCalls().map((c) => ({
      id: c.params.jobId,
      status: c.params.status,
      statusReason: c.params.statusReason ?? null,
    }));
    expect(jobStatuses).toContainEqual({
      id: 'j4',
      status: 'skipped',
      statusReason: 'dependency_not_completed',
    });
  });

  test('child workflow crash propagates to parent', async () => {
    const jobs = [dagJob('j1', 'build')];
    setCfg({
      dag: makeDag(jobs, 'r7'),
      jobResults: new Map(),
      enqueueError: 'Runner service unavailable',
    });

    await expect(executeRun()).rejects.toThrow();
  });
});
