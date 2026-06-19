import type {ProjectSourceBoundEvent} from '@shipfox/api-projects-dto';
import {startDefinitionSync} from './start-definition-sync.js';

export async function onProjectSourceBound(payload: ProjectSourceBoundEvent): Promise<void> {
  await startDefinitionSync({
    projectId: payload.projectId,
    workspaceId: payload.workspaceId,
    sourceConnectionId: payload.sourceConnectionId,
    externalRepositoryId: payload.externalRepositoryId,
  });
}
