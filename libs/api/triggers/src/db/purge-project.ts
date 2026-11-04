import {deleteInBatches, recordDeletedScope} from '@shipfox/node-drizzle';
import {and, eq, isNull} from 'drizzle-orm';
import {db} from './db.js';
import {agentSubscriptions} from './schema/agent-subscriptions.js';
import {triggersDecisions} from './schema/decisions.js';
import {triggersDeletedScopes} from './schema/deleted-scopes.js';
import {jobListenerSubscriptions} from './schema/job-listener-subscriptions.js';
import {triggerSubscriptions} from './schema/subscriptions.js';

interface ProjectScope {
  workspaceId: string;
  projectId: string;
}

/** Blocks every later root write for the project. A repeat call keeps the first marker. */
export async function recordProjectDeleted(scope: ProjectScope): Promise<void> {
  await db().transaction((tx) =>
    recordDeletedScope(tx, triggersDeletedScopes, {scope, reason: 'project_deleted'}),
  );
}

export interface PurgedProjectRows {
  subscriptions: number;
  agentSubscriptions: number;
  jobListenerSubscriptions: number;
  decisions: number;
}

/**
 * Deletes the project's rows. Subscriptions take their cron schedules with them. Listener rows
 * written before they carried a project are not found here: they go when their job ends.
 */
export async function purgeProjectRows(projectId: string): Promise<PurgedProjectRows> {
  const database = db();
  return {
    subscriptions: await deleteInBatches({
      db: database,
      table: triggerSubscriptions,
      where: eq(triggerSubscriptions.projectId, projectId),
    }),
    agentSubscriptions: await deleteInBatches({
      db: database,
      table: agentSubscriptions,
      where: eq(agentSubscriptions.projectId, projectId),
    }),
    jobListenerSubscriptions: await deleteInBatches({
      db: database,
      table: jobListenerSubscriptions,
      where: eq(jobListenerSubscriptions.projectId, projectId),
    }),
    decisions: await deleteInBatches({
      db: database,
      table: triggersDecisions,
      where: eq(triggersDecisions.projectId, projectId),
    }),
  };
}

/** Marks the purge done when no root row of the project remains. Answers whether it did. */
export async function markProjectPurgedIfEmpty(scope: ProjectScope): Promise<boolean> {
  const {projectId} = scope;
  const database = db();
  const remaining = await Promise.all([
    database
      .select({id: triggerSubscriptions.id})
      .from(triggerSubscriptions)
      .where(eq(triggerSubscriptions.projectId, projectId))
      .limit(1),
    database
      .select({id: agentSubscriptions.id})
      .from(agentSubscriptions)
      .where(eq(agentSubscriptions.projectId, projectId))
      .limit(1),
    database
      .select({id: jobListenerSubscriptions.id})
      .from(jobListenerSubscriptions)
      .where(eq(jobListenerSubscriptions.projectId, projectId))
      .limit(1),
    database
      .select({id: triggersDecisions.id})
      .from(triggersDecisions)
      .where(eq(triggersDecisions.projectId, projectId))
      .limit(1),
  ]);
  if (remaining.some((rows) => rows.length > 0)) return false;

  await database
    .update(triggersDeletedScopes)
    .set({purgedAt: new Date()})
    .where(
      and(
        eq(triggersDeletedScopes.workspaceId, scope.workspaceId),
        eq(triggersDeletedScopes.projectId, projectId),
        isNull(triggersDeletedScopes.purgedAt),
      ),
    );
  return true;
}
