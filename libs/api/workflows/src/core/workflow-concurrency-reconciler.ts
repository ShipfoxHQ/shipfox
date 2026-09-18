import {reportError} from '@shipfox/node-error-monitoring';
import type {ModuleService} from '@shipfox/node-module';
import {logger} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import {
  listWorkflowConcurrencyRepairCandidates,
  promoteWorkflowConcurrencyWaiter,
  releaseWorkflowConcurrencyClaimForAttempt,
  type WorkflowConcurrencyRepairCandidate,
} from '#db/workflow-concurrency.js';
import {cancelWorkflowRunAttemptForConcurrencyWithOutcome} from '#db/workflow-runs/run-status.js';
import {recordWorkflowConcurrencyRepair} from '#metrics/instance.js';

const SHUTDOWN_TIMEOUT_MS = 5_000;
const ERROR_BACKOFF_MS = 1_000;

export interface WorkflowConcurrencyOrchestrationStart {
  readonly workflowRunId: string;
  readonly workflowRunAttemptId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly definitionId: string;
  readonly attempt: number;
}

export interface WorkflowConcurrencyReconcilerOptions {
  pollMs?: number;
  batchSize?: number;
  runCycle?: (signal: AbortSignal) => Promise<boolean>;
  startOrchestration?: (input: WorkflowConcurrencyOrchestrationStart) => Promise<void>;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  logError?: (error: unknown) => void;
}

export interface WorkflowConcurrencyReconciler {
  service: ModuleService;
}

export function createWorkflowConcurrencyReconciler(
  options: WorkflowConcurrencyReconcilerOptions = {},
): WorkflowConcurrencyReconciler {
  const pollMs = options.pollMs ?? config.WORKFLOWS_CONCURRENCY_REPAIR_POLL_INTERVAL_MS;
  const batchSize = options.batchSize ?? config.WORKFLOWS_CONCURRENCY_REPAIR_BATCH_SIZE;
  const wait = options.wait ?? waitForRepair;
  const startOrchestration = options.startOrchestration ?? (() => Promise.resolve());
  const reportLoopError =
    options.logError ??
    ((error: unknown) => {
      logger().error({err: error}, 'Workflow concurrency reconciler failed');
      reportError(error, {boundary: 'workflows.concurrency-reconciler'});
    });

  const service: ModuleService = {
    name: 'workflow-concurrency-reconciler',
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
    start: () => {
      const controller = new AbortController();
      const finished = runWorkflowConcurrencyReconcilerLoop({
        pollMs,
        runCycle:
          options.runCycle ??
          ((signal) =>
            runWorkflowConcurrencyReconcilerCycle({
              batchSize,
              signal,
              startOrchestration,
            })),
        signal: controller.signal,
        wait,
        reportLoopError,
      });
      return Promise.resolve({
        stop: async () => {
          controller.abort();
          await finished;
        },
        finished,
      });
    },
  };

  return {service};
}

export async function runWorkflowConcurrencyReconcilerCycle(params: {
  batchSize: number;
  signal: AbortSignal;
  startOrchestration: (input: WorkflowConcurrencyOrchestrationStart) => Promise<void>;
}): Promise<boolean> {
  if (params.signal.aborted) return false;

  const {candidates} = await listWorkflowConcurrencyRepairCandidates(params.batchSize);
  let repaired = false;
  for (const candidate of candidates) {
    if (params.signal.aborted) break;
    try {
      const candidateRepaired = await repairWorkflowConcurrencyCandidate({
        candidate,
        startOrchestration: params.startOrchestration,
      });
      repaired ||= candidateRepaired;
    } catch (error) {
      recordWorkflowConcurrencyRepair(repairCategory(candidate), 'failed');
      throw error;
    }
  }
  return repaired;
}

async function repairWorkflowConcurrencyCandidate(params: {
  candidate: WorkflowConcurrencyRepairCandidate;
  startOrchestration: (input: WorkflowConcurrencyOrchestrationStart) => Promise<void>;
}): Promise<boolean> {
  const {candidate} = params;
  const category = repairCategory(candidate);
  if (category === 'terminal_holder') {
    const result = await releaseWorkflowConcurrencyClaimForAttempt(candidate.workflowRunAttemptId);
    recordWorkflowConcurrencyRepair(category, result.changed ? 'repaired' : 'no_op');
    return result.changed;
  }
  if (category === 'orphaned_group') {
    const result = await promoteWorkflowConcurrencyWaiter(candidate.claimId);
    recordWorkflowConcurrencyRepair(category, result.changed ? 'repaired' : 'no_op');
    return result.changed;
  }
  if (category === 'superseded_attempt') {
    const result = await cancelWorkflowRunAttemptForConcurrencyWithOutcome({
      workflowRunAttemptId: candidate.workflowRunAttemptId,
    });
    recordWorkflowConcurrencyRepair(category, result.changed ? 'repaired' : 'no_op');
    return result.changed;
  }

  await params.startOrchestration({
    workflowRunId: candidate.workflowRunId,
    workflowRunAttemptId: candidate.workflowRunAttemptId,
    workspaceId: candidate.workspaceId,
    projectId: candidate.projectId,
    definitionId: candidate.definitionId,
    attempt: candidate.attempt,
  });
  recordWorkflowConcurrencyRepair(category, 'repaired');
  return true;
}

function repairCategory(
  candidate: WorkflowConcurrencyRepairCandidate,
): 'terminal_holder' | 'orphaned_group' | 'superseded_attempt' | 'acquired_without_orchestration' {
  if (
    candidate.claimState === 'acquired' &&
    (isTerminal(candidate.attemptStatus) || isTerminal(candidate.runStatus))
  ) {
    return 'terminal_holder';
  }
  if (candidate.claimState === 'waiting') return 'orphaned_group';
  if (candidate.claimState === 'superseded') return 'superseded_attempt';
  return 'acquired_without_orchestration';
}

function isTerminal(status: string): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

async function runWorkflowConcurrencyReconcilerLoop(params: {
  pollMs: number;
  runCycle: (signal: AbortSignal) => Promise<boolean>;
  signal: AbortSignal;
  wait: (ms: number, signal: AbortSignal) => Promise<void>;
  reportLoopError: (error: unknown) => void;
}): Promise<void> {
  while (!params.signal.aborted) {
    try {
      const hasWork = await params.runCycle(params.signal);
      if (!hasWork) await params.wait(params.pollMs, params.signal);
    } catch (error) {
      if (params.signal.aborted) return;
      params.reportLoopError(error);
      await params.wait(ERROR_BACKOFF_MS, params.signal);
    }
  }
}

function waitForRepair(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      {once: true},
    );
    if (signal.aborted) {
      clearTimeout(timer);
      resolve();
    }
  });
}
