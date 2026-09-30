import {setTimeout as delay} from 'node:timers/promises';
import {E2eApiError, requestJson} from '@shipfox/e2e-core';
import {
  observeRun,
  type WorkflowExecutionObservation,
  type WorkflowRunObservation,
  type WorkflowRunObservationSelection,
} from '@shipfox/e2e-observe-workflows';
import type {ScenarioStep} from './schema.js';

const POLL_INTERVAL_MS = 250;
const OBSERVATION_ATTEMPT_TIMEOUT_MS = 2_000;
const TERMINAL_JOB_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'skipped']);
const TERMINAL_EXECUTION_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

type AwaitStep = Extract<ScenarioStep, {await: unknown}>['await'];

/** Ends a wait with a value, keeps waiting, or fails at once because the state can't recover. */
type Probe<T> =
  | {kind: 'done'; value: T}
  | {kind: 'waiting'; diagnostic: string}
  | {kind: 'failed'; message: string};

function isRetryableObservationError(error: unknown): boolean {
  if (error instanceof E2eApiError) return error.status === 404;
  return error instanceof Error && error.message.startsWith('Timed out while reading ');
}

async function waitFor<T>({
  description,
  timeoutMs,
  signal,
  probe,
}: {
  description: string;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
  probe: () => Promise<Probe<T>>;
}): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let diagnostic = 'nothing observed yet';
  while (true) {
    signal?.throwIfAborted();
    const result = await probe();
    if (result.kind === 'done') return result.value;
    if (result.kind === 'failed') throw new Error(`${description}: ${result.message}`);
    diagnostic = result.diagnostic;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}: ${diagnostic}`);
    }
    await delay(Math.min(POLL_INTERVAL_MS, remaining), undefined, {signal});
  }
}

async function observe({
  runId,
  token,
  selection,
  signal,
}: {
  runId: string;
  token: string;
  selection?: WorkflowRunObservationSelection;
  signal?: AbortSignal | undefined;
}): Promise<WorkflowRunObservation | undefined> {
  try {
    return await observeRun({
      runId,
      token,
      timeoutMs: OBSERVATION_ATTEMPT_TIMEOUT_MS,
      ...(selection === undefined ? {} : {selection}),
      ...(signal === undefined ? {} : {signal}),
    });
  } catch (error) {
    signal?.throwIfAborted();
    // A run that was just started may not be readable yet.
    if (isRetryableObservationError(error)) return undefined;
    throw error;
  }
}

function findListener(observation: WorkflowRunObservation, jobKey: string) {
  return observation.jobs.find((job) => job.key === jobKey && job.mode === 'listening');
}

function findExecution(
  observation: WorkflowRunObservation,
  jobKey: string,
  sequence: number,
): WorkflowExecutionObservation | undefined {
  return findListener(observation, jobKey)?.executions.find(
    (execution) => execution.sequence === sequence,
  );
}

export function describeAwait(step: AwaitStep): string {
  if ('job' in step) return `job ${step.job} ${step.status}`;
  if ('run' in step) return `run ${step.run}`;
  if ('ready' in step) return `listener ${step.listener} ready`;
  return `listener ${step.listener} execution ${step.execution} ${step.status}`;
}

interface AwaitParams<Step> {
  step: Step;
  runId: string;
  token: string;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}

type RunStep = Extract<AwaitStep, {run: unknown}>;
type JobStep = Extract<AwaitStep, {job: unknown}>;
type ReadyStep = Extract<AwaitStep, {ready: unknown}>;
type ExecutionStep = Extract<AwaitStep, {execution: unknown}>;

const DONE = {kind: 'done', value: undefined} as const;

async function awaitRun({step, runId, token, timeoutMs, signal}: AwaitParams<RunStep>) {
  await waitFor({
    description: describeAwait(step),
    timeoutMs,
    signal,
    probe: async () => {
      const observation = await observe({runId, token, signal});
      if (observation === undefined) return {kind: 'waiting', diagnostic: 'run not readable yet'};
      if (!TERMINAL_RUN_STATUSES.has(observation.status)) {
        return {kind: 'waiting', diagnostic: `run status is ${observation.status}`};
      }
      return observation.status === step.run
        ? DONE
        : {kind: 'failed', message: `the run ended ${observation.status}`};
    },
  });
}

async function awaitJob({step, runId, token, timeoutMs, signal}: AwaitParams<JobStep>) {
  await waitFor({
    description: describeAwait(step),
    timeoutMs,
    signal,
    probe: async () => {
      const observation = await observe({
        runId,
        token,
        selection: {jobs: [{jobKey: step.job}]},
        signal,
      });
      const job = observation?.jobs.find(({key}) => key === step.job);
      if (job === undefined) return {kind: 'waiting', diagnostic: `job ${step.job} missing`};
      if (job.status === step.status) return DONE;
      if (TERMINAL_JOB_STATUSES.has(job.status)) {
        return {kind: 'failed', message: `the job ended ${job.status}`};
      }
      return {kind: 'waiting', diagnostic: `job status is ${job.status}`};
    },
  });
}

async function awaitListenerReady({step, runId, token, timeoutMs, signal}: AwaitParams<ReadyStep>) {
  await waitFor({
    description: describeAwait(step),
    timeoutMs,
    signal,
    probe: async () => {
      const observation = await observe({
        runId,
        token,
        selection: {jobs: [{jobKey: step.listener}]},
        signal,
      });
      const job = observation && findListener(observation, step.listener);
      if (job === undefined) {
        return {kind: 'waiting', diagnostic: `listener job ${step.listener} missing`};
      }
      if (job.listener_status === 'resolved') {
        return {kind: 'failed', message: 'the listener resolved before it was ready'};
      }
      if (job.listener_status !== 'listening') {
        return {kind: 'waiting', diagnostic: `listener status is ${job.listener_status}`};
      }
      const readiness = await requestJson<{ready: boolean}>(
        'get',
        `/__e2e/triggers/listeners/${encodeURIComponent(job.id)}/readiness`,
        signal === undefined ? {} : {signal},
      );
      return readiness.ready
        ? DONE
        : {kind: 'waiting', diagnostic: 'trigger subscriptions pending'};
    },
  });
}

async function awaitListenerExecution({
  step,
  runId,
  token,
  timeoutMs,
  signal,
}: AwaitParams<ExecutionStep>) {
  await waitFor({
    description: describeAwait(step),
    timeoutMs,
    signal,
    probe: async () => {
      const observation = await observe({
        runId,
        token,
        selection: {jobs: [{jobKey: step.listener, executionSequences: [step.execution]}]},
        signal,
      });
      const execution = observation && findExecution(observation, step.listener, step.execution);
      if (execution === undefined) {
        return {
          kind: 'waiting',
          diagnostic: `listener ${step.listener} execution ${step.execution} missing`,
        };
      }
      if (execution.status === step.status) return DONE;
      if (TERMINAL_EXECUTION_STATUSES.has(execution.status)) {
        return {kind: 'failed', message: `the execution ended ${execution.status}`};
      }
      return {kind: 'waiting', diagnostic: `execution status is ${execution.status}`};
    },
  });
}

/**
 * Waits for one `await` step to hold. A job, execution, or run that ends in another terminal
 * status fails at once instead of waiting for the timeout.
 */
export async function runAwait({step, ...params}: AwaitParams<AwaitStep>): Promise<void> {
  if ('run' in step) return await awaitRun({step, ...params});
  if ('job' in step) return await awaitJob({step, ...params});
  if ('ready' in step) return await awaitListenerReady({step, ...params});
  return await awaitListenerExecution({step, ...params});
}
