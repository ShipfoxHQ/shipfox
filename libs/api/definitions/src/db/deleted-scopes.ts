import {recordDeletedScope} from '@shipfox/node-drizzle';
import {and, eq, isNull, sql} from 'drizzle-orm';
import {db} from './db.js';
import {definitionAgents} from './schema/agents.js';
import {workflowDefinitions} from './schema/definitions.js';
import {definitionsDeletedScopes} from './schema/deleted-scopes.js';
import {definitionSyncStates} from './schema/sync-states.js';
import {workflowWorkflows} from './schema/workflows.js';

export interface ProjectScope {
  workspaceId: string;
  projectId: string;
}

/** Blocks every later guarded write to the project. Safe to repeat. */
export async function recordProjectDeleted(params: {
  scope: ProjectScope;
  reason: string;
}): Promise<void> {
  await db().transaction((tx) => recordDeletedScope(tx, definitionsDeletedScopes, params));
}

/** Marks the project as fully purged, once no root row of it remains. Answers whether it did. */
export async function markProjectPurged(scope: ProjectScope): Promise<boolean> {
  const {projectId} = scope;
  const result = await db().execute(sql`
    select 1 where exists (select 1 from ${workflowWorkflows} where project_id = ${projectId})
      or exists (select 1 from ${workflowDefinitions} where project_id = ${projectId})
      or exists (select 1 from ${definitionSyncStates} where project_id = ${projectId})
      or exists (select 1 from ${definitionAgents} where project_id = ${projectId})
  `);
  if (result.rows.length > 0) return false;

  await db()
    .update(definitionsDeletedScopes)
    .set({purgedAt: sql`now()`})
    .where(
      and(
        eq(definitionsDeletedScopes.workspaceId, scope.workspaceId),
        eq(definitionsDeletedScopes.projectId, scope.projectId),
        isNull(definitionsDeletedScopes.purgedAt),
      ),
    );
  return true;
}
