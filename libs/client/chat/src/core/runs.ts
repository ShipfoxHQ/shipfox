import {isWorkflowStatus, type WorkflowDisplayStatus} from '@shipfox/client-workflows';
import type {ActiveRun, RunResult} from './conversation.js';

/** How many active runs show by name. The rest collapse into `+N`. */
export const VISIBLE_ACTIVE_RUNS = 3;

/**
 * A settled run's attempt is still `running`, but its one-shot work is done, so it reads as
 * `Listening`, never as running beside a finished result. An unknown status shows no icon.
 */
export function runResultStatus(
  result: Pick<RunResult, 'status'>,
): WorkflowDisplayStatus | undefined {
  if (result.status === 'settled') return 'listening';
  return isWorkflowStatus(result.status) ? result.status : undefined;
}

const STATUS_LABELS: Partial<Record<WorkflowDisplayStatus, string>> = {
  waiting: 'Waiting',
  pending: 'Pending',
  running: 'Running',
  listening: 'Listening',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function runStatusLabel(status: WorkflowDisplayStatus): string {
  return STATUS_LABELS[status] ?? status;
}

/** `2 of 5 jobs finished`, or nothing before the attempt has jobs. */
export function jobProgressLabel(
  run: Pick<ActiveRun, 'jobsFinished' | 'jobsTotal'>,
): string | undefined {
  if (run.jobsTotal === 0) return undefined;
  const noun = run.jobsTotal === 1 ? 'job' : 'jobs';
  return `${run.jobsFinished} of ${run.jobsTotal} ${noun} finished`;
}

export function isSettled(result: Pick<RunResult, 'status'>): boolean {
  return result.status === 'settled';
}

export function activeRunStatus(run: Pick<ActiveRun, 'status'>): WorkflowDisplayStatus | undefined {
  return isWorkflowStatus(run.status) ? run.status : undefined;
}

/** `implement #214`, or `Run #214` for a run with no name. */
export function runLabel(run: {name?: string | undefined; number?: number | undefined}): string {
  const name = run.name?.trim() || 'Run';
  return run.number === undefined ? name : `${name} #${run.number}`;
}

export function splitActiveRuns(runs: readonly ActiveRun[]): {
  shown: readonly ActiveRun[];
  hidden: readonly ActiveRun[];
} {
  return {shown: runs.slice(0, VISIBLE_ACTIVE_RUNS), hidden: runs.slice(VISIBLE_ACTIVE_RUNS)};
}
