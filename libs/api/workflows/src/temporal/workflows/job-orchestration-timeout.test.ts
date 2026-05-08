import {resolve} from 'node:path';
import {TestWorkflowEnvironment} from '@temporalio/testing';
import {Worker} from '@temporalio/worker';

const TASK_QUEUE = 'test-orchestration-timeout';
const WORKFLOWS_PATH = resolve(import.meta.dirname, '../../../dist/temporal/workflows/index.js');

interface ActivityCall {
  name: string;
  params: unknown;
}

let testEnv: TestWorkflowEnvironment;
let worker: Worker;
let workerRunPromise: Promise<void> | undefined;

let calls: ActivityCall[] = [];
let versionSeq = 0;
let failJobAsTimedOutShouldThrow = false;

function nextVersion(): number {
  return ++versionSeq;
}

function callsNamed(name: string): ActivityCall[] {
  return calls.filter((c) => c.name === name);
}

beforeAll(async () => {
  // Time-skipping environment lets us advance virtual time past JOB_MAX_DURATION
  // (60 minutes) without waiting in real wall time.
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();

  worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: WORKFLOWS_PATH,
    activities: {
      loadRunDag: () => ({runId: 'run-1', workspaceId: 'workspace-1', runVersion: 1, jobs: []}),
      setRunStatus: (params: unknown) => {
        calls.push({name: 'setRunStatus', params});
        return {newVersion: nextVersion()};
      },
      setJobStatus: (params: unknown) => {
        calls.push({name: 'setJobStatus', params});
        return {newVersion: nextVersion()};
      },
      bulkSetStepStatuses: (params: unknown) => {
        calls.push({name: 'bulkSetStepStatuses', params});
      },
      enqueueJobForRunner: (params: unknown) => {
        // No-op — we want the workflow to block on the signal until the timeout fires.
        calls.push({name: 'enqueueJobForRunner', params});
      },
      failJobAsTimedOutActivity: async (params: unknown) => {
        calls.push({name: 'failJobAsTimedOutActivity', params});
        if (failJobAsTimedOutShouldThrow) {
          const {ApplicationFailure} = await import('@temporalio/common');
          throw ApplicationFailure.nonRetryable('simulated DB outage');
        }
        return {newVersion: nextVersion()};
      },
    },
  });

  workerRunPromise = worker.run();
  workerRunPromise.catch(() => {
    // Suppress unhandled rejection on worker shutdown.
  });
}, 60_000);

afterAll(async () => {
  worker?.shutdown();
  await workerRunPromise;
  await testEnv?.teardown();
}, 15_000);

beforeEach(() => {
  calls = [];
  versionSeq = 0;
  failJobAsTimedOutShouldThrow = false;
});

const defaultJobInput = {
  workspaceId: 'workspace-1',
  jobId: 'job-timeout',
  runId: 'run-1',
  jobName: 'build',
  jobVersion: 1,
  steps: [{id: 'step-1', name: null, type: 'run', config: {cmd: 'echo hi'}, position: 0}],
};

function executeJob(
  input: typeof defaultJobInput,
): Promise<{status: string; jobVersion: number; output?: unknown}> {
  return testEnv.client.workflow.execute('jobOrchestration', {
    taskQueue: TASK_QUEUE,
    workflowId: `job:${input.jobId}-${Math.random()}`,
    args: [input],
  });
}

describe('jobOrchestration timeout path', () => {
  test('times out after JOB_MAX_DURATION; calls failJobAsTimedOutActivity once', async () => {
    const result = await executeJob(defaultJobInput);

    expect(result.status).toBe('failed');
    expect(result.output).toEqual({reason: 'job_timeout'});

    // failJobAsTimedOutActivity is the single critical-path call for the
    // timeout: it atomically updates the job status AND emits the outbox
    // event in the same DB transaction. setJobStatus is only called once
    // (for the 'running' transition); the timeout-failure transition goes
    // through failJobAsTimedOutActivity instead.
    expect(callsNamed('failJobAsTimedOutActivity')).toHaveLength(1);

    const setJobStatuses = callsNamed('setJobStatus').map(
      (c) => (c.params as {status: string}).status,
    );
    expect(setJobStatuses).toEqual(['running']);

    const stepCall = callsNamed('bulkSetStepStatuses')[0];
    expect((stepCall?.params as {status: string})?.status).toBe('failed');
  }, 60_000);

  test('failJobAsTimedOutActivity throws → workflow surfaces the error', async () => {
    failJobAsTimedOutShouldThrow = true;

    // Activity is configured with the default 30s startToCloseTimeout in
    // jobOrchestration; the test environment retries by default. We mark
    // the failure as nonRetryable so it surfaces immediately.
    await expect(executeJob({...defaultJobInput, jobId: 'job-fail-error'})).rejects.toThrow();

    // setJobStatus only ran for the 'running' transition before the failure
    // — the failed-status update was supposed to happen inside the activity
    // and never made it.
    const setJobStatuses = callsNamed('setJobStatus').map(
      (c) => (c.params as {status: string}).status,
    );
    expect(setJobStatuses).toEqual(['running']);
  }, 60_000);
});
