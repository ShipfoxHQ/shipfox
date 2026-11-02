import {
  type ProjectsModuleClient,
  projectsInterModuleContract,
} from '@shipfox/api-projects-dto/inter-module';
import {defineInterModulePresentation} from '@shipfox/inter-module';
import {createFakeInterModuleClients} from '@shipfox/node-module/inter-module/testing';

/**
 * Fake projects client for the conversation routes. They only read a project's
 * workspace, so every other method is stubbed to satisfy the contract.
 */
export function createTestProjectsClient(params: {
  projects: Map<string, {workspaceId: string}>;
}): ProjectsModuleClient {
  return createFakeInterModuleClients({
    projects: defineInterModulePresentation(projectsInterModuleContract, {
      getProjectById: ({projectId}) => {
        const project = params.projects.get(projectId);
        return Promise.resolve({
          project: project
            ? {
                id: projectId,
                workspaceId: project.workspaceId,
                sourceConnectionId: crypto.randomUUID(),
                sourceExternalRepositoryId: 'repository',
                name: 'Project',
              }
            : null,
        });
      },
      getProjectBySource: vi.fn(),
      findProjectBySourceRepositoryName: vi.fn(),
      listProjectsBySourceConnection: vi.fn(),
      listProjectsByWorkspace: vi.fn(),
      listProjectCatalogByWorkspace: vi.fn(),
      listAdminProjects: vi.fn(),
      requireProjectForWorkspace: vi.fn(),
      getWorkspaceProjectCounts: vi.fn(),
      resolveCheckoutTarget: vi.fn(),
    }),
  }).projects as ProjectsModuleClient;
}
