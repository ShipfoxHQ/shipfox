import {isManagedRepositoryId} from '@shipfox/api-integration-managed-vcs-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';

/** Whether the project keeps its config in a managed repository, which has no code to check out. */
export function isManagedProject(project: {sourceExternalRepositoryId: string}): boolean {
  return isManagedRepositoryId(project.sourceExternalRepositoryId);
}

export async function loadManagedSource(params: {
  readonly projects?: Pick<ProjectsModuleClient, 'getProjectById'> | undefined;
  readonly projectId: string;
}): Promise<boolean> {
  if (params.projects === undefined) return false;
  const {project} = await params.projects.getProjectById({projectId: params.projectId});
  return project !== null && project !== undefined && isManagedProject(project);
}
