import {
  RUNNER_JOB_EXECUTION_PLACEMENT_DENIED,
  type RunnersEventMap,
} from '@shipfox/api-runners-dto';
import {writeOutboxEvents} from '@shipfox/node-outbox';
import type {PolicyNotice} from '@shipfox/policy-notice';
import {and, eq, inArray} from 'drizzle-orm';
import type {Tx} from './db.js';
import {lockJobExecutionTx} from './reservation-locks.js';
import {expiredJobExecutions} from './schema/expired-job-executions.js';
import {runnersOutbox} from './schema/outbox.js';
import {pendingJobExecutions} from './schema/pending-job-executions.js';

/**
 * Fails every pending execution of one demand group because its workspace may not use any
 * template that could serve it. The tombstone keeps a redelivered queued event from bringing a
 * denied execution back, and each removed execution publishes its own denial event.
 */
export async function denyPendingJobExecutionsTx(
  tx: Tx,
  params: {workspaceId: string; requiredLabels: string[]; notice: PolicyNotice},
): Promise<number> {
  const candidates = await tx
    .select({jobExecutionId: pendingJobExecutions.jobExecutionId})
    .from(pendingJobExecutions)
    .where(
      and(
        eq(pendingJobExecutions.workspaceId, params.workspaceId),
        eq(pendingJobExecutions.requiredLabels, params.requiredLabels),
      ),
    );
  const jobExecutionIds = candidates
    .map((row) => row.jobExecutionId)
    .sort((a, b) => a.localeCompare(b));
  if (jobExecutionIds.length === 0) return 0;
  for (const jobExecutionId of jobExecutionIds) await lockJobExecutionTx(tx, jobExecutionId);

  // A claim that won the race removed its row first, so only rows still pending are denied.
  const denied = await tx
    .delete(pendingJobExecutions)
    .where(inArray(pendingJobExecutions.jobExecutionId, jobExecutionIds))
    .returning({
      workflowRunId: pendingJobExecutions.workflowRunId,
      workflowRunAttemptId: pendingJobExecutions.workflowRunAttemptId,
      jobId: pendingJobExecutions.jobId,
      jobExecutionId: pendingJobExecutions.jobExecutionId,
    });
  if (denied.length === 0) return 0;

  await tx
    .insert(expiredJobExecutions)
    .values(denied.map((row) => ({jobExecutionId: row.jobExecutionId})))
    .onConflictDoNothing();
  await writeOutboxEvents<RunnersEventMap>(
    tx,
    runnersOutbox,
    denied.map((row) => ({
      type: RUNNER_JOB_EXECUTION_PLACEMENT_DENIED,
      payload: {
        workspaceId: params.workspaceId,
        workflowRunId: row.workflowRunId,
        workflowRunAttemptId: row.workflowRunAttemptId,
        jobId: row.jobId,
        jobExecutionId: row.jobExecutionId,
        notice: params.notice,
      },
    })),
  );
  return denied.length;
}
