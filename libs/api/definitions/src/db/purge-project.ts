import {deleteInBatches} from '@shipfox/node-drizzle';
import {eq} from 'drizzle-orm';
import {db} from './db.js';
import {definitionAgents} from './schema/agents.js';
import {workflowDefinitions} from './schema/definitions.js';
import {definitionSyncStates} from './schema/sync-states.js';
import {workflowWorkflows} from './schema/workflows.js';

export interface PurgedProjectRows {
  definitions: number;
  workflows: number;
  syncStates: number;
  agents: number;
}

/**
 * Deletes the rows a project owns, in batches. Definitions go before workflows, which they
 * reference. Action snapshots stay: projects of a workspace share them by digest, and a purge
 * can't tell whether a concurrent sync or a dev run still needs one. Every step is safe to repeat.
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
  return {definitions, workflows, syncStates, agents};
}
