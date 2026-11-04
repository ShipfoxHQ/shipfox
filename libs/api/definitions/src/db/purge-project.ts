import {deleteInBatches} from '@shipfox/node-drizzle';
import {eq, sql} from 'drizzle-orm';
import {db} from './db.js';
import {definitionActionSnapshots} from './schema/action-snapshots.js';
import {definitionAgents} from './schema/agents.js';
import {workflowDefinitions} from './schema/definitions.js';
import {definitionSyncStates} from './schema/sync-states.js';
import {workflowWorkflows} from './schema/workflows.js';

export interface PurgedProjectRows {
  definitions: number;
  workflows: number;
  syncStates: number;
  agents: number;
  actionSnapshots: number;
}

/**
 * Deletes the rows a project owns, in batches. Definitions go before workflows, which they
 * reference. Every step is safe to repeat.
 */
export async function purgeProjectRows(params: {
  workspaceId: string;
  projectId: string;
}): Promise<PurgedProjectRows> {
  const {projectId} = params;
  const definitions = await deleteInBatches({
    db: db(),
    table: workflowDefinitions,
    where: eq(workflowDefinitions.projectId, projectId),
  });
  const workflows = await deleteInBatches({
    db: db(),
    table: workflowWorkflows,
    where: eq(workflowWorkflows.projectId, projectId),
  });
  const syncStates = await deleteInBatches({
    db: db(),
    table: definitionSyncStates,
    where: eq(definitionSyncStates.projectId, projectId),
  });
  const agents = await deleteInBatches({
    db: db(),
    table: definitionAgents,
    where: eq(definitionAgents.projectId, projectId),
  });
  const actionSnapshots = await purgeUnreferencedActionSnapshots(params);
  return {definitions, workflows, syncStates, agents, actionSnapshots};
}

/**
 * Snapshots are stored once per workspace and digest, so another project can reference one this
 * project stored first. The purge therefore deletes only the project's snapshots that no live
 * definition references, matching the digest anywhere in the stored model. Definitions carry no
 * workspace, so a match in another workspace keeps the snapshot too, which is safe.
 */
async function purgeUnreferencedActionSnapshots(params: {
  workspaceId: string;
  projectId: string;
}): Promise<number> {
  const result = await db().execute(sql`
    delete from ${definitionActionSnapshots} as snapshot
    where snapshot.workspace_id = ${params.workspaceId}
      and snapshot.project_id = ${params.projectId}
      and not exists (
        select 1 from ${workflowDefinitions} as definition
        where definition.deleted_at is null
          and jsonb_path_exists(
            definition.definition,
            '$.** ? (@ == $digest)',
            jsonb_build_object('digest', snapshot.digest)
          )
      )
  `);
  return result.rowCount ?? 0;
}
