import {requireWorkspaceAccess, requireWorkspaceResourceAccess} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {ClientError, type FastifyRequest} from '@shipfox/node-fastify';
import {
  InvalidCursorError,
  ManagedEntryNotFoundError,
  RetentionOutOfRangeError,
} from '#core/errors.js';

/**
 * Requires a member of the project's workspace. A project of another workspace answers the same
 * 404 as a project that does not exist, so a caller cannot probe for project ids.
 */
export async function requireProjectMember(params: {
  request: FastifyRequest;
  projectId: string;
  projects: Pick<ProjectsModuleClient, 'getProjectById'>;
}): Promise<{workspaceId: string}> {
  const notFound = () => new ClientError('Project not found', 'project-not-found', {status: 404});
  const {project} = await params.projects.getProjectById({projectId: params.projectId});
  if (project === null) throw notFound();
  requireWorkspaceResourceAccess({
    request: params.request,
    workspaceId: project.workspaceId,
    notFoundError: notFound(),
  });
  return {workspaceId: project.workspaceId};
}

export function requireWorkspaceAdmin(params: {request: FastifyRequest; workspaceId: string}) {
  const membership = requireWorkspaceAccess(params);
  if (membership.role !== 'admin') {
    throw new ClientError('Workspace admin role required', 'forbidden', {status: 403});
  }
  return membership;
}

export function translateManagementError(error: unknown): never {
  if (error instanceof ManagedEntryNotFoundError) {
    throw new ClientError('Cache entry not found', 'entry-not-found', {status: 404});
  }
  if (error instanceof InvalidCursorError) {
    throw new ClientError(error.message, 'invalid-cursor', {status: 400});
  }
  if (error instanceof RetentionOutOfRangeError) {
    throw new ClientError(error.message, 'retention-out-of-range', {status: 400});
  }
  throw error;
}
