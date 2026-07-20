import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';

export async function requireProjectAccess(
  request: FastifyRequest,
  projectId: string,
  projects: ProjectsModuleClient,
) {
  const result = await projects.getProjectById({projectId});
  if (result.project === null)
    throw new ClientError('Project not found', 'project-not-found', {status: 404});
  requireWorkspaceAccess({request, workspaceId: result.project.workspaceId});
  return result.project;
}
