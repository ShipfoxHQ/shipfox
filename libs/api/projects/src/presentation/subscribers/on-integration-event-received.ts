import type {
  GithubPushPayload,
  IntegrationEventReceivedEvent,
} from '@shipfox/api-integration-core-dto';
import {PROJECT_SOURCE_COMMIT_OBSERVED} from '@shipfox/api-projects-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {type DomainEvent, writeOutboxEvent} from '@shipfox/node-outbox';
import {db} from '#db/db.js';
import {recordIntegrationEventForProject} from '#db/integration-event-dedup.js';
import {getProjectBySource} from '#db/projects.js';
import {projectsOutbox} from '#db/schema/outbox.js';

const GITHUB_SOURCE = 'github';
const PUSH_EVENT = 'push';

export async function onIntegrationEventReceived(event: DomainEvent): Promise<void> {
  const envelope = event.payload as IntegrationEventReceivedEvent;

  if (envelope.source !== GITHUB_SOURCE || envelope.event !== PUSH_EVENT) {
    return;
  }

  const pushPayload = envelope.payload as GithubPushPayload;
  if (!pushPayload.isDefaultBranch) {
    return;
  }

  const project = await getProjectBySource({
    workspaceId: envelope.workspaceId,
    sourceConnectionId: envelope.connectionId,
    sourceExternalRepositoryId: pushPayload.externalRepositoryId,
  });
  if (!project) {
    logger().info(
      {
        eventId: event.id,
        connectionId: envelope.connectionId,
        externalRepositoryId: pushPayload.externalRepositoryId,
      },
      'integration event received: no project bound to source, dropping',
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
        provider: envelope.source,
        externalRepositoryId: pushPayload.externalRepositoryId,
        ref: pushPayload.ref,
        headCommitSha: pushPayload.headCommitSha,
      },
    });
  });
}
