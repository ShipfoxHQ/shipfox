import type {ProjectSourceCommitObservedEvent} from '@shipfox/api-projects-dto';
import {startDefinitionSync} from './start-definition-sync.js';

export async function onProjectSourceCommitObserved(
  payload: ProjectSourceCommitObservedEvent,
): Promise<void> {
  await startDefinitionSync({
    projectId: payload.projectId,
    workspaceId: payload.workspaceId,
    sourceConnectionId: payload.sourceConnectionId,
    externalRepositoryId: payload.externalRepositoryId,
    sourceRef: payload.ref,
    sourceCommitSha: payload.headCommitSha,
  });
}
