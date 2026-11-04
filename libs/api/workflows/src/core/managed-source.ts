import {isManagedRepositoryId} from '@shipfox/api-integration-managed-vcs-dto';

/** Whether the project keeps its config in a managed repository, which has no code to check out. */
export function isManagedProject(project: {sourceExternalRepositoryId: string}): boolean {
  return isManagedRepositoryId(project.sourceExternalRepositoryId);
}
