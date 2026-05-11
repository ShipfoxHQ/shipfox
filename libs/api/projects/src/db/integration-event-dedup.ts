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
