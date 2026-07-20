import type {ProjectsModuleClient} from '@shipfox/api-projects-dto';

export const projectsTestClient = {
  getProjectById: async () => ({project: undefined}),
  requireProjectForWorkspace: () => {
    throw new Error('Project is not configured');
  },
} as unknown as ProjectsModuleClient;
