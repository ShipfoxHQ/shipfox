import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {requireProjectForWorkspace} from '@shipfox/api-projects';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';

export interface ManagementAccess {
  workspaceId: string;
  userId: string;
}

export async function requireManagementRead(params: {
  request: FastifyRequest;
  workspaceId: string;
  projectId?: string | undefined;
}): Promise<ManagementAccess> {
  const membership = requireWorkspaceAccess({
    request: params.request,
    workspaceId: params.workspaceId,
  });
  if (params.projectId) {
    await requireProjectForWorkspace({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
    });
  }

  return {workspaceId: params.workspaceId, userId: membership.userId};
}

export async function requireManagementWrite(params: {
  request: FastifyRequest;
  workspaceId: string;
  projectId?: string | undefined;
}): Promise<ManagementAccess> {
  const membership = requireWorkspaceAccess({
    request: params.request,
    workspaceId: params.workspaceId,
  });
  if (membership.role !== 'admin') {
    throw new ClientError('Workspace admin role required', 'forbidden', {status: 403});
  }
  if (params.projectId) {
    await requireProjectForWorkspace({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
    });
  }

  return {workspaceId: params.workspaceId, userId: membership.userId};
}
