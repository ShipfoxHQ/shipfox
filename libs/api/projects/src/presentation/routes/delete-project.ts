import {
  AUTH_USER,
  rejectImpersonatedSession,
  requireUserContext,
  requireWorkspaceAccess,
} from '@shipfox/api-auth-context';
import {deleteProjectBodySchema} from '@shipfox/api-projects-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  DefaultProjectUndeletableError,
  deleteProject,
  ProjectNameMismatchError,
  ProjectNotFoundError,
} from '#core/index.js';
import {requireProjectAccess} from '#presentation/auth/require-project-access.js';

export const deleteProjectRoute = defineRoute({
  method: 'DELETE',
  path: '/:projectId',
  auth: AUTH_USER,
  description:
    'Delete a project and everything it owns. The project disappears at once. Workspace admins only, and the body repeats the project name.',
  schema: {
    params: z.object({projectId: z.string().uuid()}),
    body: deleteProjectBodySchema,
    response: {204: z.void()},
  },
  errorHandler: (error) => {
    if (error instanceof ProjectNotFoundError) {
      throw new ClientError('Project not found', 'project-not-found', {status: 404});
    }
    if (error instanceof DefaultProjectUndeletableError) {
      throw new ClientError(
        'The default project cannot be deleted',
        'default-project-undeletable',
        {
          status: 409,
        },
      );
    }
    if (error instanceof ProjectNameMismatchError) {
      throw new ClientError('The name does not match the project', 'project-name-mismatch', {
        status: 422,
      });
    }
    throw error;
  },
  handler: async (request, reply) => {
    rejectImpersonatedSession(request);
    const {project, workspaceId} = await requireProjectAccess({
      request,
      projectId: request.params.projectId,
    });
    const access = requireWorkspaceAccess({request, workspaceId});
    if (access.role !== 'admin') {
      throw new ClientError('Workspace admin role required', 'forbidden', {status: 403});
    }
    const actor = requireUserContext(request);

    await deleteProject({
      actorId: actor.userId,
      workspaceId,
      projectId: project.id,
      name: request.body.name,
    });
    reply.code(204);
  },
});
