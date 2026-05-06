import {getUserContext} from '@shipfox/api-auth-context';
import type {WorkspaceRole} from '@shipfox/api-workspaces-dto';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import type {Workspace} from '#core/entities/workspace.js';
import {getWorkspaceById} from '#db/workspaces.js';

export interface RequireMembershipParams {
  request: FastifyRequest;
  workspaceId: string;
}

export interface RequireMembershipResult {
  workspaceId: string;
  workspace: Workspace;
  userId: string;
  role: WorkspaceRole;
}

export async function requireMembership(
  params: RequireMembershipParams,
): Promise<RequireMembershipResult> {
  const client = getUserContext(params.request);
  if (!client) {
    throw new ClientError('Authentication required', 'unauthorized', {status: 401});
  }

  if (!client.canAccess(params.workspaceId)) {
    throw new ClientError('Not a member of this workspace', 'forbidden', {status: 403});
  }

  const workspace = await getWorkspaceById(params.workspaceId);
  if (!workspace) {
    throw new ClientError('Workspace not found', 'not-found', {status: 404});
  }
  if (workspace.status !== 'active') {
    throw new ClientError('Workspace is not active', 'workspace-inactive', {status: 403});
  }

  const membership = client.memberships.find((m) => m.workspaceId === workspace.id);
  if (!membership) {
    throw new ClientError('Not a member of this workspace', 'forbidden', {status: 403});
  }

  return {workspaceId: workspace.id, workspace, userId: client.userId, role: membership.role};
}
