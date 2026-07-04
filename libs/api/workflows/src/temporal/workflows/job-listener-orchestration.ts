import {
  CancellationScope,
  condition,
  defineSignal,
  executeChild,
  log,
  ParentClosePolicy,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';
import type {ResolutionReason} from '#core/entities/job.js';
import {runtimeStatusForTerminalJobExecutionStatus} from '#core/job-execution-orchestration.js';
import type {RuntimeCompletionStatus} from '#core/workflow-scheduling/runtime-dag.js';
import type {createOrchestrationActivities} from '../activities/index.js';
import {LISTENER_EVENTS_AVAILABLE_SIGNAL, LISTENER_RESOLVE_SIGNAL} from '../constants.js';
import {jobExecutionOrchestration} from './job-execution-orchestration.js';

const {
  activateJobListenerActivity,
  drainListenerEventsActivity,
  resolveJobListenerActivity,
  settleListenerJobExecutionActivity,
  recordListenerFiringOutcomeActivity,
  cancelRunnerJobsActivity,
} = proxyActivities<ReturnType<typeof createOrchestrationActivities>>({
  startToCloseTimeout: '30s',
});

export const listenerEventsAvailableSignal = defineSignal<[]>(LISTENER_EVENTS_AVAILABLE_SIGNAL);
export const listenerResolveSignal = defineSignal<[]>(LISTENER_RESOLVE_SIGNAL);

export interface JobListenerOrchestrationInput {
  workspaceId: string;
  workflowRunId: string;
  projectId: string;
  runAttemptId: string;
  jobId: string;
  jobVersion: number;
  requiredLabels: string[];
  executionTimeoutMs?: number | null | undefined;
  listeningTimeoutMs?: number | null | undefined;
  maxExecutions?: number | null | undefined;
  onResolve?: 'finish' | 'cancel' | null | undefined;
}

export interface JobListenerOrchestrationResult {
  status: RuntimeCompletionStatus;
  jobVersion: number;
}

type ResolutionLatch = Exclude<ResolutionReason, 'cancelled'> | undefined;

export async function jobListenerOrchestration(
  input: JobListenerOrchestrationInput,
): Promise<JobListenerOrchestrationResult> {
  let eventsAvailable = false;
  let latchedReason: ResolutionLatch;

  setHandler(listenerEventsAvailableSignal, () => {
    eventsAvailable = true;
  });
  setHandler(listenerResolveSignal, () => {
    latchedReason = 'until';
  });

  const listenerDeadline =
    input.listeningTimeoutMs === undefined || input.listeningTimeoutMs === null
      ? undefined
      : Date.now() + input.listeningTimeoutMs;

  const activated = await activateJobListenerActivity({
    jobId: input.jobId,
    expectedVersion: input.jobVersion,
  });
  if (activated.status === 'terminal') {
    return {
      status: runtimeStatusForTerminalJobExecutionStatus(activated.jobStatus),
      jobVersion: activated.jobVersion,
    };
  }

  let nextSequence = activated.executionCount + 1;
  const maxExecutions = input.maxExecutions ?? undefined;
  while (true) {
    if (deadlineReached(listenerDeadline)) latchedReason ??= 'timeout';
    if (latchedReason !== undefined) break;
    if (maxExecutions !== undefined) {
      if (nextSequence > maxExecutions) {
        latchedReason = 'max_executions';
        break;
      }
    }

    eventsAvailable = false;
    const drained = await drainListenerEventsActivity({
      jobId: input.jobId,
      expectedSequence: nextSequence,
    });

    if (drained.kind === 'resolve-requested') {
      latchedReason = 'until';
      break;
    }

    if (drained.kind === 'empty') {
      const woke = await waitForListenerWakeup(
        () => eventsAvailable || latchedReason !== undefined,
        {deadline: listenerDeadline},
      );
      if (!woke && deadlineReached(listenerDeadline)) latchedReason = 'timeout';
      continue;
    }

    if (drained.status === 'failed') {
      await recordListenerFiringOutcomeActivity({outcome: 'failed'});
      nextSequence = drained.sequence + 1;
      if (maxExecutions !== undefined && drained.sequence >= maxExecutions) {
        latchedReason = 'max_executions';
      }
      continue;
    }

    await runListenerExecution({
      input,
      jobExecutionId: drained.jobExecutionId,
      executionVersion: drained.executionVersion,
      shouldCancelForResolution: () =>
        input.onResolve === 'cancel' &&
        (latchedReason !== undefined || deadlineReached(listenerDeadline)),
      waitForResolution: () =>
        waitForListenerWakeup(
          () => latchedReason !== undefined || deadlineReached(listenerDeadline),
          {deadline: listenerDeadline},
        ),
    });

    if (deadlineReached(listenerDeadline)) latchedReason ??= 'timeout';
    nextSequence = drained.sequence + 1;
    if (maxExecutions !== undefined && drained.sequence >= maxExecutions) {
      latchedReason = 'max_executions';
    }
  }

  const reason = latchedReason ?? 'timeout';
  const resolved = await resolveJobListenerActivity({jobId: input.jobId, reason});
  return {status: resolved.status, jobVersion: resolved.jobVersion};
}

async function runListenerExecution(params: {
  input: JobListenerOrchestrationInput;
  jobExecutionId: string;
  executionVersion: number;
  shouldCancelForResolution: () => boolean;
  waitForResolution: () => Promise<boolean>;
}): Promise<void> {
  const scope = new CancellationScope();
  const child = scope.run(() =>
    executeChild(jobExecutionOrchestration, {
      workflowId: `job:${params.input.jobId}`,
      workflowIdReusePolicy: 'ALLOW_DUPLICATE',
      args: [
        {
          workspaceId: params.input.workspaceId,
          workflowRunId: params.input.workflowRunId,
          projectId: params.input.projectId,
          jobId: params.input.jobId,
          jobExecutionId: params.jobExecutionId,
          runAttemptId: params.input.runAttemptId,
          jobVersion: params.input.jobVersion,
          executionVersion: params.executionVersion,
          ...(params.input.executionTimeoutMs === undefined
            ? {}
            : {executionTimeoutMs: params.input.executionTimeoutMs}),
          resolveJobStatus: false,
          requiredLabels: params.input.requiredLabels,
        },
      ],
      parentClosePolicy: ParentClosePolicy.TERMINATE,
    }),
  );

  if (params.input.onResolve === 'cancel') {
    const winner = await Promise.race([
      child.then(
        () => 'child' as const,
        () => 'child-failed' as const,
      ),
      params.waitForResolution().then(() => 'resolution' as const),
    ]);
    if (winner === 'resolution' && params.shouldCancelForResolution()) {
      scope.cancel();
      await settleListenerJobExecutionActivity({
        jobExecutionId: params.jobExecutionId,
        status: 'cancelled',
      });
      await recordListenerFiringOutcomeActivity({outcome: 'cancelled'});
      await cancelRunnerJobsActivity({jobIds: [params.input.jobId]});
      return;
    }
  }

  try {
    const result = await child;
    await recordListenerFiringOutcomeActivity({outcome: result.status});
  } catch (error) {
    log.warn('listener execution child failed; recording failed firing and continuing', {
      jobId: params.input.jobId,
      jobExecutionId: params.jobExecutionId,
      error: String(error),
    });
    await settleListenerJobExecutionActivity({
      jobExecutionId: params.jobExecutionId,
      status: 'failed',
    });
    await recordListenerFiringOutcomeActivity({outcome: 'failed'});
  }
}

async function waitForListenerWakeup(
  predicate: () => boolean,
  options: {deadline: number | undefined},
): Promise<boolean> {
  const remaining = remainingMs(options.deadline);
  if (remaining !== undefined && remaining <= 0) return false;
  if (remaining === undefined) {
    await condition(predicate);
    return true;
  }
  return await condition(predicate, remaining);
}

function deadlineReached(deadline: number | undefined): boolean {
  return deadline !== undefined && Date.now() >= deadline;
}

function remainingMs(deadline: number | undefined): number | undefined {
  return deadline === undefined ? undefined : Math.max(0, deadline - Date.now());
}
