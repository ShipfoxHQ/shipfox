import type {RuntimeCompletionStatus, RuntimeDagNode} from '../scheduling/runtime-dag.js';
import {findBlockedNodes, findReadyNodes} from '../scheduling/runtime-dag.js';

export type RuntimeCancelReason = 'dependency_failed' | 'unsatisfiable_dependencies';

export interface RuntimeCancelJobsCommand<T extends RuntimeDagNode = RuntimeDagNode> {
  kind: 'cancel_jobs';
  jobs: readonly T[];
  reason: RuntimeCancelReason;
}

export interface RuntimeStartJobsCommand<T extends RuntimeDagNode = RuntimeDagNode> {
  kind: 'start_jobs';
  jobs: readonly T[];
}

export interface RuntimeCompleteRunCommand {
  kind: 'complete_run';
  status: RuntimeCompletionStatus;
}

export type RuntimeSchedulingCommand<T extends RuntimeDagNode = RuntimeDagNode> =
  | RuntimeCancelJobsCommand<T>
  | RuntimeStartJobsCommand<T>
  | RuntimeCompleteRunCommand;

export interface RuntimeSchedulingState<T extends RuntimeDagNode = RuntimeDagNode> {
  jobs: readonly T[];
  completed: ReadonlyMap<string, RuntimeCompletionStatus>;
}

/**
 * Plans the next deterministic scheduling commands for a materialized runtime DAG.
 *
 * The caller owns command application. This function never starts jobs, writes
 * state, calls activities, or talks to Temporal.
 */
export function planRunSchedulingCommands<T extends RuntimeDagNode>(
  state: RuntimeSchedulingState<T>,
): readonly RuntimeSchedulingCommand<T>[] {
  const commands: RuntimeSchedulingCommand<T>[] = [];
  const completedAfterBlocked = new Map(state.completed);

  const blocked = findBlockedNodes(state.jobs, completedAfterBlocked);
  if (blocked.length > 0) {
    commands.push({kind: 'cancel_jobs', jobs: blocked, reason: 'dependency_failed'});
    for (const job of blocked) {
      completedAfterBlocked.set(job.name, 'failed');
    }
  }

  if (completedAfterBlocked.size >= state.jobs.length) {
    commands.push({kind: 'complete_run', status: runStatus(completedAfterBlocked)});
    return commands;
  }

  const ready = findReadyNodes(state.jobs, completedAfterBlocked);
  if (ready.length > 0) {
    commands.push({kind: 'start_jobs', jobs: ready});
    return commands;
  }

  const remaining = state.jobs.filter((job) => !completedAfterBlocked.has(job.name));
  if (remaining.length > 0) {
    commands.push({
      kind: 'cancel_jobs',
      jobs: remaining,
      reason: 'unsatisfiable_dependencies',
    });
    commands.push({kind: 'complete_run', status: 'failed'});
  }

  return commands;
}

function runStatus(
  completed: ReadonlyMap<string, RuntimeCompletionStatus>,
): RuntimeCompletionStatus {
  return [...completed.values()].some((status) => status === 'failed') ? 'failed' : 'succeeded';
}
