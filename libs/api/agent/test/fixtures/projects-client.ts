import {
  type ProjectsModuleClient,
  projectsInterModuleContract,
} from '@shipfox/api-projects-dto/inter-module';
import {createInterModuleKnownError, defineInterModulePresentation} from '@shipfox/inter-module';
import {createFakeInterModuleClients} from '@shipfox/node-module/inter-module/testing';

/**
 * Fake projects client for the conversation routes. They only read a project's
 * workspace, so every other method is stubbed to satisfy the contract. A project left out of the
 * map, or deleted from it, is a deleted project.
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
                isDefault: false,
              }
            : null,
        });
      },
      getProjectBySource: vi.fn(),
      findProjectBySourceRepositoryName: vi.fn(),
      listProjectsByWorkspace: vi.fn(),
      listProjectCatalogByWorkspace: vi.fn(),
      getDefaultProject: vi.fn(),
      listAdminProjects: vi.fn(),
      getProjectsByIds: vi.fn(),
      requireProjectForWorkspace: ({projectId, workspaceId}) => {
        const project = params.projects.get(projectId);
        if (!project) {
          throw createInterModuleKnownError(
            projectsInterModuleContract.methods.requireProjectForWorkspace,
            'project-not-found',
            {projectId},
          );
        }
        if (project.workspaceId !== workspaceId) {
          throw createInterModuleKnownError(
            projectsInterModuleContract.methods.requireProjectForWorkspace,
            'project-workspace-mismatch',
            {projectId, workspaceId},
          );
        }
        return Promise.resolve({
          project: {
            id: projectId,
            workspaceId,
            sourceConnectionId: crypto.randomUUID(),
            sourceExternalRepositoryId: 'repository',
            name: 'Project',
            isDefault: false,
          },
        } as never);
      },
      getWorkspaceProjectCounts: vi.fn(),
      moveProjectSource: vi.fn(),
      getProjectAccessPolicy: vi.fn(),
      getProjectAccessPolicies: vi.fn(),
      resolveCheckoutTarget: vi.fn(),
    }),
  }).projects as ProjectsModuleClient;
}
