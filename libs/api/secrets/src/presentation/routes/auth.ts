import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {type ProjectsModuleClient, projectsInterModuleContract} from '@shipfox/api-projects-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';

export interface ManagementAccess {
  workspaceId: string;
  userId: string;
}

export interface ManagementAccessHelpers {
  requireManagementRead(params: {
    request: FastifyRequest;
    workspaceId: string;
    projectId?: string | undefined;
  }): Promise<ManagementAccess>;
  requireManagementWrite(params: {
    request: FastifyRequest;
    workspaceId: string;
    projectId?: string | undefined;
  }): Promise<ManagementAccess>;
}

export function createManagementAccess(projects: ProjectsModuleClient): ManagementAccessHelpers {
  return {
    requireManagementRead: (params: {
      request: FastifyRequest;
      workspaceId: string;
      projectId?: string | undefined;
    }) => requireManagementRead(params, projects),
    requireManagementWrite: (params: {
      request: FastifyRequest;
      workspaceId: string;
      projectId?: string | undefined;
    }) => requireManagementWrite(params, projects),
  };
}

async function requireManagementRead(
  params: {
    request: FastifyRequest;
    workspaceId: string;
    projectId?: string | undefined;
  },
  projects: ProjectsModuleClient,
): Promise<ManagementAccess> {
  const membership = requireWorkspaceAccess({
    request: params.request,
    workspaceId: params.workspaceId,
  });
  if (params.projectId) {
    await requireProjectForWorkspace(params.workspaceId, params.projectId, projects);
  }

  return {workspaceId: params.workspaceId, userId: membership.userId};
}

async function requireManagementWrite(
  params: {
    request: FastifyRequest;
    workspaceId: string;
    projectId?: string | undefined;
  },
  projects: ProjectsModuleClient,
): Promise<ManagementAccess> {
  const membership = requireWorkspaceAccess({
    request: params.request,
    workspaceId: params.workspaceId,
  });
  if (membership.role !== 'admin') {
    throw new ClientError('Workspace admin role required', 'forbidden', {status: 403});
  }
  if (params.projectId) {
    await requireProjectForWorkspace(params.workspaceId, params.projectId, projects);
  }

  return {workspaceId: params.workspaceId, userId: membership.userId};
}

async function requireProjectForWorkspace(
  workspaceId: string,
  projectId: string,
  projects: ProjectsModuleClient,
): Promise<void> {
  try {
    await projects.requireProjectForWorkspace({workspaceId, projectId});
  } catch (error) {
    if (
      isInterModuleKnownError(projectsInterModuleContract.methods.requireProjectForWorkspace, error)
    ) {
      throw new ClientError('Project not found', 'project-not-found', {status: 404});
    }
    throw error;
  }
}
