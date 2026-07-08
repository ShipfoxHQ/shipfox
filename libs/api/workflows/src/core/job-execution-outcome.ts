import type {RuntimeCompletionStatus} from './workflow-scheduling/runtime-dag.js';

export interface JobExecutionOrchestrationResult {
  status: RuntimeCompletionStatus;
  jobVersion: number;
}

export type JobExecutionStartOutcome =
  | {kind: 'running'; runningVersion: number}
  | {kind: 'terminal'; result: JobExecutionOrchestrationResult};

export interface JobExecutionStatusWriteResult {
  newVersion: number;
  status?: string | undefined;
}

export interface JobExecutionOutcomeSignals {
  finished: {status: RuntimeCompletionStatus; jobExecutionId?: string | undefined} | undefined;
  leaseExpired: boolean;
}

export type JobExecutionOutcomeResolution = 'finished' | 'lease-expired' | 'timed-out';

export function hasNoRequiredRunnerLabels(labels: readonly string[]): boolean {
  return labels.every((label) => label.trim().length === 0);
}

export function jobExecutionStartOutcome(
  result: JobExecutionStatusWriteResult,
): JobExecutionStartOutcome {
  if (result.status !== undefined && result.status !== 'pending' && result.status !== 'running') {
    return {
      kind: 'terminal',
      result: {
        status: runtimeStatusForTerminalJobExecutionStatus(result.status),
        jobVersion: result.newVersion,
      },
    };
  }

  return {kind: 'running', runningVersion: result.newVersion};
}

export function runtimeStatusForTerminalJobExecutionStatus(
  status: string,
): RuntimeCompletionStatus {
  if (
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'skipped'
  ) {
    return status;
  }
  return 'failed';
}

export function resolveJobExecutionOutcomeSignal(
  signals: JobExecutionOutcomeSignals,
): JobExecutionOutcomeResolution {
  if (signals.finished !== undefined) return 'finished';
  if (signals.leaseExpired) return 'lease-expired';
  return 'timed-out';
}
