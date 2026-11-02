import {AUTH_USER, requireUserContext, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto/inter-module';
import {
  type CreateProjectBodyDto,
  createProjectBodySchema,
  type ManagedProjectSourceBodyDto,
  projectResponseSchema,
} from '@shipfox/api-projects-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import type {FeatureFlags} from '@shipfox/node-feature-flags';
import {
  createManagedProject,
  createProjectFromSource,
  ProjectAlreadyExistsError,
  ProjectSlugConflictError,
} from '#core/index.js';
import {toProjectDto} from '#presentation/dto/index.js';
import {projectsFlags} from '../../flags.js';

function providerStatus(reason: string): number {
  if (reason === 'rate-limited') return 429;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  return 422;
}

export function createProjectRoute(integrations: IntegrationsModuleClient, flags: FeatureFlags) {
  return defineRoute({
    method: 'POST',
    path: '/',
    auth: AUTH_USER,
    description:
      'Create a project bound to a source repository, or to a repository Shipfox hosts when the source is managed.',
    schema: {
      body: createProjectBodySchema,
      response: {
        201: projectResponseSchema,
      },
    },
    errorHandler: (error) => {
      handleResolveSourceRepositoryError(error);
      const known = isInterModuleKnownError(
        integrationsInterModuleContract.methods.resolveSourceRepository,
        error,
      )
        ? error
        : undefined;
      if (error instanceof ProjectAlreadyExistsError) {
        throw new ClientError(error.message, 'project-already-exists', {
          details: {
            existing_project_id: error.existingProjectId,
            source_connection_id: error.sourceConnectionId,
            source_external_repository_id: error.sourceExternalRepositoryId,
          },
          status: 409,
        });
      }
      if (error instanceof ProjectSlugConflictError) {
        throw new ClientError('Project slug already exists', 'slug-conflict', {status: 409});
      }
      handleCreateManagedRepositoryError(error);
      if (known?.code === 'provider-failure') {
        throw new ClientError('Integration provider request failed', known.details.reason, {
          details: {retry_after_seconds: known.details.retryAfterSeconds},
          status: providerStatus(known.details.reason),
        });
      }
      throw error;
    },
    handler: async (request, reply) => {
      const {workspace_id: workspaceId, name, slug, source} = request.body;
      const actor = requireUserContext(request);

      requireWorkspaceAccess({request, workspaceId});
      const project =
        'kind' in source
          ? await createManagedProjectFromBody({
              flags,
              integrations,
              actor,
              body: request.body,
              source,
            })
          : await createProjectFromSource({
              actorId: actor.userId,
              workspaceId,
              name,
              slug,
              sourceConnectionId: source.connection_id,
              sourceExternalRepositoryId: source.external_repository_id,
              integrations,
            });

      reply.status(201);
      return toProjectDto(project);
    },
  });
}

function handleResolveSourceRepositoryError(error: unknown): void {
  if (
    !isInterModuleKnownError(integrationsInterModuleContract.methods.resolveSourceRepository, error)
  )
    return;
  if (error.code === 'connection-not-found') {
    throw new ClientError('Source connection not found', 'source-connection-not-found', {
      status: 404,
    });
  }
  if (error.code === 'connection-workspace-mismatch') {
    throw new ClientError('Source connection does not belong to this workspace', 'forbidden', {
      status: 403,
    });
  }
  if (error.code === 'connection-inactive') {
    throw new ClientError('Source connection is not active', 'source-connection-inactive', {
      status: 422,
    });
  }
  if (error.code === 'provider-unavailable') {
    throw new ClientError(
      'Integration provider is unavailable',
      'integration-provider-unavailable',
      {status: 422},
    );
  }
  if (error.code === 'capability-unavailable') {
    throw new ClientError(
      'Integration capability is unavailable',
      'integration-capability-unavailable',
      {status: 422},
    );
  }
}

async function createManagedProjectFromBody(params: {
  flags: FeatureFlags;
  integrations: IntegrationsModuleClient;
  actor: {userId: string};
  body: CreateProjectBodyDto;
  source: ManagedProjectSourceBodyDto;
}) {
  const {body, source} = params;
  // Not available reads the same as a feature this workspace doesn't have.
  const enabled = await params.flags.boolean(projectsFlags['managed-config-repos'], {
    workspaceId: body.workspace_id,
  });
  if (!enabled) {
    throw new ClientError(
      'Projects without a repository are not available for this workspace',
      'managed-source-unavailable',
      {status: 422},
    );
  }
  return await createManagedProject({
    actorId: params.actor.userId,
    workspaceId: body.workspace_id,
    name: body.name,
    slug: body.slug,
    files: source.files,
    integrations: params.integrations,
  });
}

function handleCreateManagedRepositoryError(error: unknown): void {
  if (
    !isInterModuleKnownError(integrationsInterModuleContract.methods.createManagedRepository, error)
  ) {
    return;
  }
  if (error.code === 'invalid-seed-file') {
    throw new ClientError('A starting file is not valid', 'invalid-source-file', {
      details: {problem: error.details.problem, path: error.details.path},
      status: 422,
    });
  }
  throw new ClientError('Project already has a repository', 'project-already-exists', {
    status: 409,
  });
}
