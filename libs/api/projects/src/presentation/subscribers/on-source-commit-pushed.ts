import type {IntegrationSourceCommitPushedEvent} from '@shipfox/api-integration-core-dto';
import {PROJECT_SOURCE_COMMIT_OBSERVED} from '@shipfox/api-projects-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {type DomainEvent, writeOutboxEvent} from '@shipfox/node-outbox';
import {db} from '#db/db.js';
import {recordIntegrationEventForProject} from '#db/integration-event-dedup.js';
import {getProjectBySource} from '#db/projects.js';
import {projectsOutbox} from '#db/schema/outbox.js';

export async function onSourceCommitPushed(event: DomainEvent): Promise<void> {
  const {provider, workspaceId, connectionId, push} =
    event.payload as IntegrationSourceCommitPushedEvent;

  // Projects only track the default branch; other branches are someone else's policy.
  if (!push.isDefaultBranch) {
    return;
  }

  const project = await getProjectBySource({
    workspaceId,
    sourceConnectionId: connectionId,
    sourceExternalRepositoryId: push.externalRepositoryId,
  });
  if (!project) {
    logger().info(
      {
        eventId: event.id,
        connectionId,
        externalRepositoryId: push.externalRepositoryId,
      },
      'source commit pushed: no project bound to source, dropping',
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
        provider,
        externalRepositoryId: push.externalRepositoryId,
        ref: push.ref,
        headCommitSha: push.headCommitSha,
      },
    });
  });
}
