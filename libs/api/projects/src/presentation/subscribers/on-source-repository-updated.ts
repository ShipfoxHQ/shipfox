import type {IntegrationSourceRepositoryUpdatedEvent} from '@shipfox/api-integration-core-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {DomainEvent} from '@shipfox/node-outbox';
import {db} from '#db/db.js';
import {recordIntegrationEventForProject} from '#db/integration-event-dedup.js';
import {REPOSITORY_RESOURCE_KIND, renameConnectionResource} from '#db/project-access.js';
import {getProjectBySource, updateProjectSourceRepository} from '#db/projects.js';

export async function onSourceRepositoryUpdated(
  payload: IntegrationSourceRepositoryUpdatedEvent,
  event: DomainEvent<IntegrationSourceRepositoryUpdatedEvent>,
): Promise<void> {
  // The stored names of a listed repository follow the rename, whether or not a project uses the
  // repository as its config source.
  const fullName = `${payload.repository.owner}/${payload.repository.name}`;
  await renameConnectionResource({
    connectionId: payload.connectionId,
    kind: REPOSITORY_RESOURCE_KIND,
    externalId: payload.repository.externalRepositoryId,
    lookupName: fullName.toLowerCase(),
    displayName: fullName,
  });

  const project = await getProjectBySource({
    workspaceId: payload.workspaceId,
    sourceConnectionId: payload.connectionId,
    sourceExternalRepositoryId: payload.repository.externalRepositoryId,
  });

  if (project) {
    const outcome = await db().transaction(async (tx) => {
      const {firstSeen} = await recordIntegrationEventForProject({
        tx,
        integrationEventId: event.id,
        projectId: project.id,
      });
      if (!firstSeen) return 'duplicate';

      const updated = await updateProjectSourceRepository({
        tx,
        workspaceId: payload.workspaceId,
        sourceConnectionId: payload.connectionId,
        sourceExternalRepositoryId: payload.repository.externalRepositoryId,
        sourceRepositoryOwner: payload.repository.owner,
        sourceRepositoryName: payload.repository.name,
        sourceDefaultBranch: payload.repository.defaultBranch,
      });
      return updated ? 'updated' : 'missing';
    });

    if (outcome !== 'missing') return;
  }

  logger().info(
    {
      eventId: event.id,
      connectionId: payload.connectionId,
      externalRepositoryId: payload.repository.externalRepositoryId,
    },
    'source repository updated: no project bound to source, dropping',
  );
}
