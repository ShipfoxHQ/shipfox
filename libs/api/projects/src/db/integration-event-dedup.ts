import {deleteInBatches} from '@shipfox/node-drizzle';
import {eq, lt} from 'drizzle-orm';
import {db} from './db.js';
import {projectsIntegrationEventDedup} from './schema/integration-event-dedup.js';

// biome-ignore lint/suspicious/noExplicitAny: cross-module drizzle tx without a portable exported type
type DrizzleTxLike = any;

export interface RecordIntegrationEventForProjectParams {
  tx: DrizzleTxLike;
  integrationEventId: string;
  projectId: string;
}

export async function recordIntegrationEventForProject(
  params: RecordIntegrationEventForProjectParams,
): Promise<{firstSeen: boolean}> {
  const inserted = await params.tx
    .insert(projectsIntegrationEventDedup)
    .values({
      integrationEventId: params.integrationEventId,
      projectId: params.projectId,
    })
    .onConflictDoNothing({
      target: [
        projectsIntegrationEventDedup.integrationEventId,
        projectsIntegrationEventDedup.projectId,
      ],
    })
    .returning({projectId: projectsIntegrationEventDedup.projectId});

  return {firstSeen: inserted.length > 0};
}

/** Deletes the dedup rows of a project, in batches. Returns how many it deleted. */
export async function deleteIntegrationEventDedupForProject(projectId: string): Promise<number> {
  return await deleteInBatches({
    db: db(),
    table: projectsIntegrationEventDedup,
    where: eq(projectsIntegrationEventDedup.projectId, projectId),
  });
}

export interface PruneIntegrationEventDedupParams {
  olderThan: Date;
}

export async function pruneIntegrationEventDedup(
  params: PruneIntegrationEventDedupParams,
): Promise<{deleted: number}> {
  const result = await db()
    .delete(projectsIntegrationEventDedup)
    .where(lt(projectsIntegrationEventDedup.receivedAt, params.olderThan));
  return {deleted: result.rowCount ?? 0};
}
