import {sql} from 'drizzle-orm';
import type {WorkflowRunStatus} from '#core/entities/workflow-run.js';
import {db} from '../db.js';

export interface LatestSyncedWorkflowRun {
  id: string;
  definitionId: string;
  number: number;
  status: WorkflowRunStatus;
  createdAt: Date;
}

interface LatestSyncedWorkflowRunRow extends Record<string, unknown> {
  id: string;
  definition_id: string;
  number: number;
  status: WorkflowRunStatus;
  created_at: Date | string;
}

/**
 * The newest synced run of each definition, in one statement. The lateral probe reads
 * `workflows_wr_project_definition_created_id_idx` backwards once per definition, so the cost
 * follows the number of definitions and not the length of their run history. Dev runs never
 * count: a branch experiment says nothing about the workflow's health on the default branch.
 */
export async function listLatestSyncedWorkflowRuns(params: {
  projectId: string;
  definitionIds: readonly string[];
}): Promise<LatestSyncedWorkflowRun[]> {
  if (params.definitionIds.length === 0) return [];

  const requested = sql.join(
    params.definitionIds.map((definitionId) => sql`(${definitionId}::uuid)`),
    sql`, `,
  );
  const result = await db().execute<LatestSyncedWorkflowRunRow>(sql`
    select latest.id, latest.definition_id, latest.number, latest.status, latest.created_at
    from (values ${requested}) as requested(definition_id)
    cross join lateral (
      select run.id, run.definition_id, run.number, run.status, run.created_at
      from workflows_workflow_runs as run
      where run.project_id = ${params.projectId}
        and run.definition_id = requested.definition_id
        and run.origin = 'synced'
      order by run.created_at desc, run.id desc
      limit 1
    ) as latest
  `);

  return result.rows.map((row) => ({
    id: row.id,
    definitionId: row.definition_id,
    number: row.number,
    status: row.status,
    createdAt: new Date(row.created_at),
  }));
}
