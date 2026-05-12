import type {IntegrationRepositoryPushedEvent} from '@shipfox/api-integration-core-dto';
import {PROJECT_SOURCE_COMMIT_OBSERVED} from '@shipfox/api-projects-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {type DomainEvent, writeOutboxEvent} from '@shipfox/node-outbox';
import {db} from '#db/db.js';
import {recordIntegrationEventForProject} from '#db/integration-event-dedup.js';
import {getProjectBySource} from '#db/projects.js';
import {projectsOutbox} from '#db/schema/outbox.js';

export async function onIntegrationRepositoryPushed(event: DomainEvent): Promise<void> {
  const payload = event.payload as IntegrationRepositoryPushedEvent;

  if (!payload.isDefaultBranch) {
    return;
  }

  const project = await getProjectBySource({
    workspaceId: payload.workspaceId,
    sourceConnectionId: payload.connectionId,
    sourceExternalRepositoryId: payload.externalRepositoryId,
  });
  if (!project) {
    logger().info(
      {
        eventId: event.id,
        connectionId: payload.connectionId,
        externalRepositoryId: payload.externalRepositoryId,
      },
      'integration push: no project bound to source, dropping',
    );
    return;
  }

  await db().transaction(async (tx) => {
    const {firstSeen} = await recordIntegrationEventForProject({
      tx,
      integrationEventId: event.id,
      projectId: project.id,
    });
    if (!firstSeen) return;

    await writeOutboxEvent(tx, projectsOutbox, {
      type: PROJECT_SOURCE_COMMIT_OBSERVED,
      payload: {
        workspaceId: project.workspaceId,
        projectId: project.id,
        sourceConnectionId: project.sourceConnectionId,
        provider: payload.provider,
        externalRepositoryId: payload.externalRepositoryId,
        ref: payload.ref,
        headCommitSha: payload.headCommitSha,
      },
    });
  });
}
