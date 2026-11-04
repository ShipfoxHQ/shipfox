import {
  type ProjectsModuleClient,
  projectsInterModuleContract,
} from '@shipfox/api-projects-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {ProjectDeletedError} from './errors.js';

/**
 * A project that is deleted, or isn't in the workspace, takes no new run. It holds for every start
 * path and whatever the jobs check out or call, so the check can't be skipped by a job that
 * needs no source.
 */
export async function assertProjectAdmitsNewRuns(
  projects: Pick<ProjectsModuleClient, 'requireProjectForWorkspace'>,
  params: {workspaceId: string; projectId: string},
): Promise<void> {
  try {
    await projects.requireProjectForWorkspace(params);
  } catch (error) {
    if (
      isInterModuleKnownError(projectsInterModuleContract.methods.requireProjectForWorkspace, error)
    ) {
      throw new ProjectDeletedError(params.projectId);
    }
    throw error;
  }
}
