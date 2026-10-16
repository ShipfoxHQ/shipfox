import {WORKFLOW_SOURCE_SNAPSHOT_MAX_BYTES} from '@shipfox/api-workflows-dto';
import {and, eq, sql} from 'drizzle-orm';
import type {WorkflowRunOrigin, WorkflowSourceSnapshot} from '#core/entities/workflow-run.js';
import {db} from '../db.js';
import {jobExecutions} from '../schema/job-executions.js';
import {jobs} from '../schema/jobs.js';
import {steps} from '../schema/steps.js';
import {workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {workflowRuns} from '../schema/workflow-runs.js';

export interface WorkflowRunSourceRead {
  workflowRunId: string;
  workflowRunAttempt: number;
  origin: WorkflowRunOrigin;
  sourceSnapshot: WorkflowSourceSnapshot | null;
  sourceSnapshotBytes: number | null;
}

/**
 * Loads only the immutable source projection for a run attempt. The legacy
 * string form keeps the HTTP route pinned to the run's current attempt; the
 * object form lets bounded inter-module callers select a concrete attempt.
 */
export async function getWorkflowRunSource(
  params: string | {workflowRunId: string; attempt?: number | undefined},
): Promise<WorkflowRunSourceRead | undefined> {
  const workflowRunId = typeof params === 'string' ? params : params.workflowRunId;
  const attempt = typeof params === 'string' ? undefined : params.attempt;
  const [row] = await db()
    .select({
      workflowRunId: workflowRuns.id,
      workflowRunAttempt: workflowRunAttempts.attempt,
      origin: workflowRuns.origin,
      // Keep legacy snapshots out of the application process. The byte count
      // remains available so the DTO can distinguish an omitted snapshot from
      // one that is too large to inline.
      sourceSnapshot: sql<WorkflowSourceSnapshot | null>`case
        when ${workflowRuns.sourceSnapshot} is null then null
        when jsonb_typeof(${workflowRuns.sourceSnapshot}) = 'object'
          and octet_length(coalesce(${workflowRuns.sourceSnapshot}->>'content', '')) <= ${WORKFLOW_SOURCE_SNAPSHOT_MAX_BYTES}
        then ${workflowRuns.sourceSnapshot}
        else null
      end`,
      sourceSnapshotBytes: sql<number | null>`case
        when ${workflowRuns.sourceSnapshot} is null then null
        when jsonb_typeof(${workflowRuns.sourceSnapshot}) = 'object'
        then octet_length(coalesce(${workflowRuns.sourceSnapshot}->>'content', ''))
        else null
      end`,
    })
    .from(workflowRuns)
    .innerJoin(
      workflowRunAttempts,
      and(
        eq(workflowRunAttempts.workflowRunId, workflowRuns.id),
        attempt === undefined
          ? eq(workflowRunAttempts.attempt, workflowRuns.currentAttempt)
          : eq(workflowRunAttempts.attempt, attempt),
      ),
    )
    .where(eq(workflowRuns.id, workflowRunId))
    .limit(1);

  if (!row) return undefined;
  return {
    workflowRunId: row.workflowRunId,
    workflowRunAttempt: row.workflowRunAttempt,
    origin: row.origin as WorkflowRunOrigin,
    sourceSnapshot: row.sourceSnapshot ?? null,
    sourceSnapshotBytes: row.sourceSnapshotBytes ?? null,
  };
}

/** Whether a step of the run ran a composite action with this snapshot digest. */
export async function workflowRunUsesCompositeAction(params: {
  workflowRunId: string;
  digest: string;
}): Promise<boolean> {
  const [row] = await db()
    .select({id: steps.id})
    .from(steps)
    .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .where(
      and(
        eq(workflowRunAttempts.workflowRunId, params.workflowRunId),
        eq(steps.type, 'composite'),
        sql`${steps.config} -> 'composite' ->> 'digest' = ${params.digest}`,
      ),
    )
    .limit(1);
  return row !== undefined;
}
