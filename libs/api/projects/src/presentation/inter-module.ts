import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import {createTimestampIdCursor, timestampIdCursorTimestamp} from '@shipfox/node-drizzle';
import {SYSTEM_ACTOR_ID, tryEnsureDefaultProject} from '#core/default-project.js';
import type {Project} from '#core/entities/project.js';
import {
  ProjectAlreadyExistsError,
  ProjectNotFoundError,
  ProjectSourceChangedError,
} from '#core/errors.js';
import {getProjectAccess, getProjectAccesses} from '#core/project-access.js';
import {moveProjectSource} from '#core/projects.js';
import {
  findProjectBySourceRepositoryName,
  getDefaultProject,
  getProjectById,
  getProjectBySource,
  getProjectLabelsByIds,
  getWorkspaceProjectCounts,
  listAdminProjects,
  listProjects,
  listProjectsBySourceConnection,
  type ProjectRepositoryListCursor,
  type ProjectRepositoryListItem,
  resolveCheckoutTarget,
} from '#db/projects.js';

export function createProjectsInterModulePresentation(deps: {
  integrations: IntegrationsModuleClient;
}): InterModulePresentation<typeof projectsInterModuleContract> {
  return defineInterModulePresentation(projectsInterModuleContract, {
    getProjectById: async ({projectId}) => ({project: (await getProjectById(projectId)) ?? null}),
    getProjectBySource: async (input) => ({
      project: (await getProjectBySource(input)) ?? null,
    }),
    findProjectBySourceRepositoryName: async (input) => ({
      projects: await findProjectBySourceRepositoryName(input),
    }),
    listProjectsBySourceConnection: async (input) => {
      const result = await listProjectsBySourceConnection({
        workspaceId: input.workspaceId,
        sourceConnectionId: input.sourceConnectionId,
        limit: input.limit,
        ...(input.cursor
          ? {
              cursor: {
                sourceRepositoryOwner: input.cursor.owner,
                sourceRepositoryName: input.cursor.name,
                sourceExternalRepositoryId: input.cursor.externalRepositoryId,
              },
            }
          : {}),
      });

      return {
        projects: result.projects.map(toProjectRepositoryInterModule),
        nextCursor: toProjectRepositoryCursor(result.nextCursor),
      };
    },
    listProjectsByWorkspace: async ({workspaceId, limit, cursor}) => {
      const result = await listProjectPage({workspaceId, limit, cursor});
      return {
        projects: result.projects.map(toProjectInterModule),
        nextCursor: toProjectCursor(result.nextCursor),
      };
    },
    listProjectCatalogByWorkspace: async ({workspaceId, limit, cursor}) => {
      const result = await listProjectPage({workspaceId, limit, cursor});
      return {
        projects: result.projects.map(toProjectCatalogInterModule),
        nextCursor: toProjectCursor(result.nextCursor),
      };
    },
    listAdminProjects: async ({cursor, ...input}) => {
      const result = await listAdminProjects({
        ...input,
        ...(cursor ? {cursor: createTimestampIdCursor(cursor)} : {}),
      });
      return {
        projects: result.projects.map((project) => ({
          id: project.id,
          workspaceId: project.workspaceId,
          name: project.name,
          slug: project.slug,
          createdAt: project.createdAt.toISOString(),
          updatedAt: project.updatedAt.toISOString(),
          deletedAt: project.deletedAt?.toISOString() ?? null,
        })),
        nextCursor: toProjectCursor(result.nextCursor),
      };
    },
    getProjectsByIds: async (input) => {
      const labels = await getProjectLabelsByIds(input);
      return {
        projects: labels.map((label) => ({
          ...label,
          deletedAt: label.deletedAt?.toISOString() ?? null,
        })),
      };
    },
    getDefaultProject: async ({workspaceId}) => {
      const existing = await getDefaultProject(workspaceId);
      if (existing) return {project: existing};
      // A workspace made before default projects has none until the first read creates it.
      const created = await tryEnsureDefaultProject({
        actorId: SYSTEM_ACTOR_ID,
        workspaceId,
        integrations: deps.integrations,
      });
      return {project: created ?? null};
    },
    requireProjectForWorkspace: async ({projectId, workspaceId}) => {
      const project = await getProjectById(projectId);
      if (project === undefined) {
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
      return {project};
    },
    getWorkspaceProjectCounts: async ({workspaceIds}) => ({
      counts: await getWorkspaceProjectCounts({workspaceIds}),
    }),
    moveProjectSource: async (input) => {
      const method = projectsInterModuleContract.methods.moveProjectSource;
      try {
        return await moveProjectSource(input);
      } catch (error) {
        if (error instanceof ProjectNotFoundError) {
          throw createInterModuleKnownError(method, 'project-not-found', {
            projectId: input.projectId,
          });
        }
        if (error instanceof ProjectSourceChangedError) {
          throw createInterModuleKnownError(method, 'source-changed', {
            projectId: input.projectId,
          });
        }
        if (error instanceof ProjectAlreadyExistsError) {
          throw createInterModuleKnownError(method, 'source-already-bound', {
            existingProjectId: error.existingProjectId,
          });
        }
        throw error;
      }
    },
    getProjectAccessPolicy: async (input) => {
      try {
        return {policy: (await getProjectAccess(input)).policy};
      } catch (error) {
        if (error instanceof ProjectNotFoundError) {
          throw createInterModuleKnownError(
            projectsInterModuleContract.methods.getProjectAccessPolicy,
            'project-not-found',
            {projectId: input.projectId},
          );
        }
        throw error;
      }
    },
    getProjectAccessPolicies: async (input) => ({
      policies: (await getProjectAccesses(input)).map((view) => view.policy),
    }),
    resolveCheckoutTarget: async (input) => {
      const target = await resolveCheckoutTarget(input);
      if (target === undefined) {
        throw createInterModuleKnownError(
          projectsInterModuleContract.methods.resolveCheckoutTarget,
          'checkout-repository-not-authorized',
          {},
        );
      }

      return target;
    },
  });
}

async function listProjectPage(input: {
  workspaceId: string;
  limit: number;
  cursor?: {createdAt: string; id: string} | undefined;
}) {
  return await listProjects({
    workspaceId: input.workspaceId,
    limit: input.limit,
    ...(input.cursor ? {cursor: createTimestampIdCursor(input.cursor)} : {}),
  });
}

function toProjectCursor(cursor: {createdAt: Date; id: string} | null) {
  return cursor ? {createdAt: timestampIdCursorTimestamp(cursor), id: cursor.id} : null;
}

function toProjectRepositoryInterModule(repository: ProjectRepositoryListItem) {
  return {
    externalRepositoryId: repository.sourceExternalRepositoryId,
    owner: repository.sourceRepositoryOwner,
    name: repository.sourceRepositoryName,
    projectId: repository.projectId,
    projectName: repository.projectName,
    projectSlug: repository.projectSlug,
  };
}

function toProjectRepositoryCursor(cursor: ProjectRepositoryListCursor | null) {
  return cursor
    ? {
        owner: cursor.sourceRepositoryOwner,
        name: cursor.sourceRepositoryName,
        externalRepositoryId: cursor.sourceExternalRepositoryId,
      }
    : null;
}

function toProjectCatalogInterModule(project: Project) {
  return {
    ...toProjectInterModule(project),
    slug: project.slug,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function toProjectInterModule(project: Project) {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    sourceConnectionId: project.sourceConnectionId,
    sourceExternalRepositoryId: project.sourceExternalRepositoryId,
    sourceRepositoryOwner: project.sourceRepositoryOwner,
    sourceRepositoryName: project.sourceRepositoryName,
    sourceDefaultBranch: project.sourceDefaultBranch,
    name: project.name,
    isDefault: project.isDefault,
  };
}
