import type {ProjectSourceBoundEvent} from '@shipfox/api-projects-dto';
import type {DomainEvent} from '@shipfox/node-outbox';
import {startDefinitionSync} from './start-definition-sync.js';

export async function onProjectSourceBound(event: DomainEvent): Promise<void> {
  const payload = event.payload as ProjectSourceBoundEvent;
  await startDefinitionSync({
    projectId: payload.projectId,
    workspaceId: payload.workspaceId,
    sourceConnectionId: payload.sourceConnectionId,
    externalRepositoryId: payload.externalRepositoryId,
  });
}
