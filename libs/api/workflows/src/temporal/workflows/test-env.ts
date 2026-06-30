import {resolve} from 'node:path';
import {TestWorkflowEnvironment} from '@temporalio/testing';
import {Worker} from '@temporalio/worker';
import type {RuntimeCompletionStatus} from '#core/entities/runtime-dag.js';
import type {RunDag} from '../activities/orchestration-activities.js';
import {JOB_FINISHED_SIGNAL, JOB_LEASE_EXPIRED_SIGNAL} from '../constants.js';

const TASK_QUEUE = 'test-orchestration';
const WORKFLOWS_PATH = resolve(import.meta.dirname, '../../../dist/temporal/workflows/index.js');

export {TASK_QUEUE};

// ---------------------------------------------------------------------------
// Shared mutable test config — each test sets this before starting a workflow.
// Activities read from it via closure. Tests run serially within a describe.
// ---------------------------------------------------------------------------

export interface TestConfig {
  dag: RunDag;
  /** Map of jobId → status the mock runner should signal back */
  jobResults: Map<string, RuntimeCompletionStatus>;
  /** If set, enqueueJobExecutionForRunner will throw with this message instead of signaling */
  enqueueError?: string;
  /** If true, enqueueJobExecutionForRunner sends two job-finished signals (for dedup testing) */
  duplicateSignal?: boolean;
  /** If true, enqueueJobExecutionForRunner does nothing (no signal — for timeout testing) */
  skipSignal?: boolean;
  /** If true, signal job-lease-expired instead of job-finished */
  signalLeaseExpired?: boolean;
  /** If true, signal BOTH job-finished and job-lease-expired (precedence testing) */
  signalBoth?: boolean;
  /** Status resolveLeaseExpiredJobExecutionActivity returns (defaults to 'failed') */
  leaseExpiredStatus?: RuntimeCompletionStatus;
  /** If set, resolveJobStatusFromJobExecutionsActivity throws with this message */
  resolveJobStatusError?: string;
  /** If set, releaseLeaseActivity throws (non-retryable) to prove the workflow still returns */
  releaseLeaseError?: string;
  /** If set, failJobExecutionAsTimedOutActivity throws (for timeout error-path testing) */
  failJobExecutionAsTimedOutError?: string;
  /** Effective status returned by the initial running setRunStatus call */
  initialRunStatus?: string;
  /** Effective status returned by a running setJobStatus call */
  runningJobStatus?: string;
}

export let cfg: TestConfig;

export function setCfg(value: TestConfig): void {
  cfg = value;
}

// Track every activity call for assertions
export interface ActivityCall {
  name: string;
  params: unknown;
}

export let calls: ActivityCall[];
let versionSeq: number;

function nextVersion(): number {
  return ++versionSeq;
}

export function resetCalls(): void {
  calls = [];
  versionSeq = 0;
}

export function callsNamed(name: string): ActivityCall[] {
  return calls.filter((c) => c.name === name);
}

export function setRunStatusCalls() {
  return callsNamed('setRunStatus') as Array<{
    name: string;
    params: {runId: string; status: string; version: number};
  }>;
}

export function setJobStatusCalls() {
  return callsNamed('setJobStatus') as Array<{
    name: string;
    params: {jobId: string; status: string; version: number; statusReason?: string | null};
  }>;
}

export function setExecutionStatusCalls() {
  return callsNamed('setJobExecutionStatus') as Array<{
    name: string;
    params: {jobExecutionId: string; status: string; version: number; statusReason?: string | null};
  }>;
}

// ---------------------------------------------------------------------------
// DAG helpers
// ---------------------------------------------------------------------------

export function dagJob(
  id: string,
  name: string,
  deps: string[] = [],
  options: {status?: RunDag['jobs'][number]['status']} = {},
): RunDag['jobs'][number] {
  return {
    id,
    name,
    status: options.status ?? 'pending',
    jobExecutionId: id,
    executionVersion: 1,
    executionTimeoutMs: null,
    dependencies: deps,
    runner: ['ubuntu22'],
    version: 1,
    steps: [{id: `${id}-step`, name: null, type: 'run', config: {cmd: 'echo'}, position: 0}],
  };
}

export function makeDag(jobs: RunDag['jobs'], runId = 'run-1'): RunDag {
  return {runId, workspaceId: 'workspace-1', projectId: 'project-1', runVersion: 1, jobs};
}

// ---------------------------------------------------------------------------
// Environment lifecycle
// ---------------------------------------------------------------------------

export let testEnv: TestWorkflowEnvironment;
export let worker: Worker;

let workerRunPromise: Promise<void> | undefined;

export async function setupEnv(): Promise<void> {
  testEnv = await TestWorkflowEnvironment.createLocal();

  worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: WORKFLOWS_PATH,
    activities: createMockActivities(),
  });

  // Run worker in background — it processes tasks until shutdown is called
  workerRunPromise = worker.run();
  workerRunPromise.catch(() => {
    // Suppress unhandled rejection on shutdown
  });
}

export async function teardownEnv(): Promise<void> {
  worker?.shutdown();
  await workerRunPromise;
  await testEnv?.teardown();
}

function createMockActivities() {
  return {
    loadRunDag: (runId: string): RunDag => {
      calls.push({name: 'loadRunDag', params: runId});
      return cfg.dag;
    },

    setRunStatus: (params: {runId: string; status: string; version: number}) => {
      calls.push({name: 'setRunStatus', params});
      const status =
        params.status === 'running' && cfg.initialRunStatus ? cfg.initialRunStatus : params.status;
      return {newVersion: nextVersion(), status};
    },

    setJobStatus: (params: {
      jobId: string;
      status: string;
      version: number;
      statusReason?: string | null;
    }) => {
      calls.push({name: 'setJobStatus', params});
      const status =
        params.status === 'running' && cfg.runningJobStatus ? cfg.runningJobStatus : params.status;
      return {newVersion: nextVersion(), status};
    },

    setJobExecutionStatus: (params: {
      jobExecutionId: string;
      status: string;
      version: number;
      statusReason?: string | null;
    }) => {
      calls.push({name: 'setJobExecutionStatus', params});
      const status =
        params.status === 'running' && cfg.runningJobStatus ? cfg.runningJobStatus : params.status;
      return {newVersion: nextVersion(), status};
    },

    bulkSetStepStatuses: (params: {jobExecutionId: string; status: string}) => {
      calls.push({name: 'bulkSetStepStatuses', params});
    },

    cancelRunnerJobsActivity: (params: {jobIds: string[]}) => {
      calls.push({name: 'cancelRunnerJobsActivity', params});
    },

    // Scheduling is step-less. The mock runner reports the job outcome by signalling
    // the per-step terminal-completion signal (job-finished) and/or the lease-expiry
    // signal, reproducing the outbox → subscriber → signal rail.
    enqueueJobExecutionForRunner: async (params: {
      workspaceId: string;
      jobId: string;
      jobExecutionId: string;
      runId: string;
      projectId: string;
      requiredLabels: string[];
    }) => {
      calls.push({name: 'enqueueJobExecutionForRunner', params});

      if (cfg.enqueueError) {
        const {ApplicationFailure} = await import('@temporalio/common');
        throw ApplicationFailure.nonRetryable(cfg.enqueueError);
      }

      if (cfg.skipSignal) return;

      const status = cfg.jobResults.get(params.jobId) ?? 'succeeded';
      const handle = testEnv.client.workflow.getHandle(`job:${params.jobId}`);

      if (cfg.signalLeaseExpired) {
        await handle.signal(JOB_LEASE_EXPIRED_SIGNAL);
        return;
      }

      if (cfg.signalBoth) {
        await handle.signal(JOB_FINISHED_SIGNAL, {status});
        await handle.signal(JOB_LEASE_EXPIRED_SIGNAL);
        return;
      }

      await handle.signal(JOB_FINISHED_SIGNAL, {status});

      if (cfg.duplicateSignal) {
        await handle.signal(JOB_FINISHED_SIGNAL, {status: 'failed'});
      }
    },

    resolveLeaseExpiredJobExecutionActivity: (params: {
      jobExecutionId: string;
      expectedVersion: number;
    }) => {
      calls.push({name: 'resolveLeaseExpiredJobExecutionActivity', params});
      return {status: cfg.leaseExpiredStatus ?? 'failed', executionVersion: nextVersion()};
    },

    resolveJobStatusFromJobExecutionsActivity: async (params: {jobId: string}) => {
      calls.push({name: 'resolveJobStatusFromJobExecutionsActivity', params});
      if (cfg.resolveJobStatusError) {
        const {ApplicationFailure} = await import('@temporalio/common');
        throw ApplicationFailure.nonRetryable(cfg.resolveJobStatusError);
      }
      const terminalExecutionStatus = [...setExecutionStatusCalls()]
        .reverse()
        .find(
          (call) => call.params.jobExecutionId === params.jobId && call.params.status !== 'running',
        )?.params.status as RuntimeCompletionStatus | undefined;
      return {
        status: cfg.leaseExpiredStatus ?? terminalExecutionStatus ?? 'succeeded',
        jobVersion: nextVersion(),
      };
    },

    releaseLeaseActivity: async (params: {jobExecutionId: string}) => {
      calls.push({name: 'releaseLeaseActivity', params});
      if (cfg.releaseLeaseError) {
        const {ApplicationFailure} = await import('@temporalio/common');
        throw ApplicationFailure.nonRetryable(cfg.releaseLeaseError);
      }
    },

    failJobExecutionAsTimedOutActivity: async (params: {
      jobExecutionId: string;
      runId: string;
      expectedVersion: number;
    }) => {
      calls.push({name: 'failJobExecutionAsTimedOutActivity', params});
      if (cfg.failJobExecutionAsTimedOutError) {
        const {ApplicationFailure} = await import('@temporalio/common');
        throw ApplicationFailure.nonRetryable(cfg.failJobExecutionAsTimedOutError);
      }
      return {newVersion: nextVersion()};
    },
  };
}
