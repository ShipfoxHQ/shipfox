import {
  type ProjectsModuleClient,
  projectsInterModuleContract,
} from '@shipfox/api-projects-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';

export const projectsTestClient = {
  getProjectById: async () => ({project: undefined}),
  requireProjectForWorkspace: () => {
    throw new Error('Project is not configured');
  },
} as unknown as ProjectsModuleClient;

/** Admits every project, as a live one does, and knows no source. */
export const projectsAdmittingTestClient = {
  getProjectById: () => Promise.resolve({project: undefined}),
  requireProjectForWorkspace: () => Promise.resolve({project: undefined}),
} as unknown as ProjectsModuleClient;

/** Refuses every project, as a deleted one is refused. */
export const projectsDeletedTestClient = {
  getProjectById: () => Promise.resolve({project: null}),
  requireProjectForWorkspace: ({projectId}: {projectId: string}) =>
    Promise.reject(
      createInterModuleKnownError(
        projectsInterModuleContract.methods.requireProjectForWorkspace,
        'project-not-found',
        {projectId},
      ),
    ),
} as unknown as ProjectsModuleClient;
