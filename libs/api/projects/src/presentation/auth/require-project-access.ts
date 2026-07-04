import {getUserContext, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import type {Project} from '#core/entities/index.js';
import {getProjectById} from '#db/index.js';

export interface RequireProjectAccessParams {
  request: FastifyRequest;
  projectId: string;
}

export interface RequireProjectAccessResult {
  project: Project;
  workspaceId: string;
}

export async function requireProjectAccess(
  params: RequireProjectAccessParams,
): Promise<RequireProjectAccessResult> {
  const userContext = getUserContext(params.request);
  if (!userContext) {
    throw new ClientError('Authentication required', 'unauthorized', {status: 401});
  }

  const project = await getProjectById(params.projectId);
  if (!project) throw new ClientError('Project not found', 'project-not-found', {status: 404});
  requireWorkspaceAccess({request: params.request, workspaceId: project.workspaceId});
  return {project, workspaceId: project.workspaceId};
}
