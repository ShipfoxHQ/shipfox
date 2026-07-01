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
let failJobExecutionAsTimedOutShouldThrow = false;

function nextVersion(): number {
  return ++versionSeq;
}

function callsNamed(name: string): ActivityCall[] {
  return calls.filter((c) => c.name === name);
}

beforeAll(async () => {
  // Time-skipping environment lets us advance virtual time past the execution
  // timeout without waiting in real wall time.
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();

  worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: WORKFLOWS_PATH,
    activities: {
      loadRunAttemptDag: () => ({
        workflowRunId: 'run-1',
        runAttemptId: 'run-attempt-1',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
        runVersion: 1,
        jobs: [],
      }),
      setRunAttemptStatus: (params: unknown) => {
        calls.push({name: 'setRunAttemptStatus', params});
        return {newVersion: nextVersion()};
      },
      setJobStatus: (params: unknown) => {
        calls.push({name: 'setJobStatus', params});
        return {newVersion: nextVersion()};
      },
      setJobExecutionStatus: (params: unknown) => {
        calls.push({name: 'setJobExecutionStatus', params});
        return {newVersion: nextVersion(), status: (params as {status?: string}).status};
      },
      bulkSetStepStatuses: (params: unknown) => {
        calls.push({name: 'bulkSetStepStatuses', params});
      },
      resolveLeaseExpiredJobExecutionActivity: (params: unknown) => {
        calls.push({name: 'resolveLeaseExpiredJobExecutionActivity', params});
        return {status: 'failed', executionVersion: nextVersion()};
      },
      resolveJobStatusFromJobExecutionsActivity: (params: unknown) => {
        calls.push({name: 'resolveJobStatusFromJobExecutionsActivity', params});
        return {status: 'failed', jobVersion: nextVersion()};
      },
      releaseLeaseActivity: (params: unknown) => {
        calls.push({name: 'releaseLeaseActivity', params});
      },
      enqueueJobExecutionForRunner: (params: unknown) => {
        // No-op — we want the workflow to block on the signal until the timeout fires.
        calls.push({name: 'enqueueJobExecutionForRunner', params});
      },
      failJobExecutionAsTimedOutActivity: async (params: unknown) => {
        calls.push({name: 'failJobExecutionAsTimedOutActivity', params});
        if (failJobExecutionAsTimedOutShouldThrow) {
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
  failJobExecutionAsTimedOutShouldThrow = false;
});

const defaultJobInput = {
  workspaceId: 'workspace-1',
  jobId: 'job-timeout',
  runAttemptId: 'run-attempt-1',
  projectId: 'project-1',
  jobVersion: 1,
  jobExecutionId: 'job-timeout',
  executionVersion: 1,
  requiredLabels: ['ubuntu22'],
};

function executeJob(input: typeof defaultJobInput): Promise<{status: string; jobVersion: number}> {
  const normalized = {
    ...input,
    jobExecutionId:
      input.jobExecutionId === defaultJobInput.jobExecutionId &&
      input.jobId !== defaultJobInput.jobId
        ? input.jobId
        : input.jobExecutionId,
  };
  return testEnv.client.workflow.execute('jobExecutionOrchestration', {
    taskQueue: TASK_QUEUE,
    workflowId: `job:${input.jobId}-${Math.random()}`,
    args: [normalized],
  });
}

describe('jobExecutionOrchestration timeout path', () => {
  test('times out after JOB_MAX_DURATION; calls failJobExecutionAsTimedOutActivity then bulkSetStepStatuses', async () => {
    const result = await executeJob(defaultJobInput);

    expect(result.status).toBe('failed');

    expect(callsNamed('failJobExecutionAsTimedOutActivity')).toHaveLength(1);

    const setJobStatuses = callsNamed('setJobExecutionStatus').map(
      (c) => (c.params as {status: string}).status,
    );
    expect(setJobStatuses).toEqual(['running']);

    // Timeout path sweeps steps with the bulk activity (no per-step detail).
    const stepCall = callsNamed('bulkSetStepStatuses')[0];
    expect((stepCall?.params as {status: string})?.status).toBe('failed');
    // The lease is intentionally NOT released on the timeout path (the TIMED_OUT
    // event drives cooperative cancel; the stuck detector reaps the row).
    expect(callsNamed('releaseLeaseActivity')).toHaveLength(0);
    expect(callsNamed('resolveLeaseExpiredJobExecutionActivity')).toHaveLength(0);
  }, 60_000);

  test('failJobExecutionAsTimedOutActivity throws → workflow surfaces the error', async () => {
    failJobExecutionAsTimedOutShouldThrow = true;

    await expect(executeJob({...defaultJobInput, jobId: 'job-fail-error'})).rejects.toThrow();

    const setJobStatuses = callsNamed('setJobExecutionStatus').map(
      (c) => (c.params as {status: string}).status,
    );
    expect(setJobStatuses).toEqual(['running']);
  }, 60_000);
});
