import {
  AUTH_USER,
  rejectImpersonatedSession,
  requireUserContext,
  requireWorkspaceAccess,
} from '@shipfox/api-auth-context';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {
  projectAccessResponseSchema,
  updateProjectAccessBodySchema,
} from '@shipfox/api-projects-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  ProjectAccessInvalidError,
  ProjectAccessProviderError,
  ProjectNotFoundError,
} from '#core/errors.js';
import type {ProjectAccessView} from '#core/project-access.js';
import {getProjectAccess, setProjectAccess} from '#core/project-access.js';
import {requireProjectAccess} from '#presentation/auth/require-project-access.js';
import {type ConnectionLabel, toProjectAccessDto} from '#presentation/dto/index.js';

const projectParamsSchema = z.object({projectId: z.string().uuid()});

const invalidReasonCodes = {
  'connection-invalid': 'access-connection-invalid',
  'connection-duplicate': 'access-connection-duplicate',
  'resource-kind-unsupported': 'access-resource-kind-unsupported',
  'resource-not-found': 'resource-not-found',
  'empty-resource-scope': 'access-resource-scope-empty',
  'access-limit-exceeded': 'access-limit-exceeded',
} as const;

function providerStatus(reason: string): number {
  if (reason === 'rate-limited') return 429;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  return 422;
}

function handleAccessError(error: unknown): never {
  if (error instanceof ProjectNotFoundError) {
    throw new ClientError('Project not found', 'project-not-found', {status: 404});
  }
  if (error instanceof ProjectAccessInvalidError) {
    throw new ClientError(error.message, invalidReasonCodes[error.reason], {
      status: 422,
      ...(error.connectionId === undefined ? {} : {details: {connection_id: error.connectionId}}),
    });
  }
  if (error instanceof ProjectAccessProviderError) {
    throw new ClientError('Integration provider request failed', error.providerReason, {
      status: providerStatus(error.providerReason),
      details: {retry_after_seconds: error.retryAfterSeconds},
    });
  }
  throw error;
}

// A connection deleted since the last read has no label yet, and the client shows it as gone.
async function loadConnectionLabels(
  integrations: IntegrationsModuleClient,
  view: ProjectAccessView,
): Promise<Map<string, ConnectionLabel>> {
  const labels = new Map<string, ConnectionLabel>();
  if (view.access.connectionAccess === 'all') return labels;
  await Promise.all(
    view.access.scopes.map(async ({connectionId}) => {
      const connection = await integrations.resolveConnectionById({connectionId});
      if (connection?.workspaceId === view.project.workspaceId) {
        labels.set(connectionId, {
          provider: connection.provider,
          displayName: connection.displayName,
        });
      }
    }),
  );
  return labels;
}

export function createGetProjectAccessRoute(integrations: IntegrationsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/:projectId/access',
    auth: AUTH_USER,
    description: 'Get the connections and resources a project can use.',
    schema: {
      params: projectParamsSchema,
      response: {200: projectAccessResponseSchema},
    },
    errorHandler: handleAccessError,
    handler: async (request) => {
      const {project, workspaceId} = await requireProjectAccess({
        request,
        projectId: request.params.projectId,
      });
      const view = await getProjectAccess({workspaceId, projectId: project.id});
      return toProjectAccessDto(view, await loadConnectionLabels(integrations, view));
    },
  });
}

export function createUpdateProjectAccessRoute(integrations: IntegrationsModuleClient) {
  return defineRoute({
    method: 'PUT',
    path: '/:projectId/access',
    auth: AUTH_USER,
    description: 'Replace the connections and resources a project can use. Workspace admins only.',
    schema: {
      params: projectParamsSchema,
      body: updateProjectAccessBodySchema,
      response: {200: projectAccessResponseSchema},
    },
    errorHandler: handleAccessError,
    handler: async (request) => {
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

      const {connections} = request.body;
      const view = await setProjectAccess({
        actorId: actor.userId,
        correlationId: request.id,
        workspaceId,
        projectId: project.id,
        connections:
          connections === 'all'
            ? 'all'
            : connections.map((connection) => ({
                connectionId: connection.connection_id,
                resources:
                  connection.resources === 'all'
                    ? 'all'
                    : connection.resources.map((resource) => ({
                        kind: resource.kind,
                        externalId: resource.external_id,
                      })),
              })),
        integrations,
      });
      return toProjectAccessDto(view, await loadConnectionLabels(integrations, view));
    },
  });
}
