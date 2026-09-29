import {
  type ManagedModelProvider,
  modelProviderCatalogResponseSchema,
  type WorkspaceProvidersPolicy,
} from '@shipfox/api-agent-dto';
import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {buildModelProviderCatalogResponse} from '#core/index.js';
import {getManagedModelLocks} from '#core/managed-model-locks.js';
import {toModelProviderCatalogResponseDto} from '#presentation/dto/index.js';

export function createListModelProviderCatalogRoute(
  options: {
    managedProvider?: ManagedModelProvider | undefined;
    workspaceProviders?: WorkspaceProvidersPolicy | undefined;
  } = {},
) {
  const workspaceProviders = options.workspaceProviders ?? 'enabled';

  return defineRoute({
    method: 'GET',
    path: '/model-provider-catalog',
    description: 'List available model providers and models',
    schema: {
      response: {
        200: modelProviderCatalogResponseSchema,
      },
    },
    handler: () =>
      toModelProviderCatalogResponseDto(
        buildModelProviderCatalogResponse({
          managedProvider: options.managedProvider,
          workspaceProviders,
        }),
      ),
  });
}

export const listModelProviderCatalogRoute = createListModelProviderCatalogRoute();

/** The catalog for one workspace, with the managed models it cannot run right now marked `locked`. */
export function createListWorkspaceModelProviderCatalogRoute(
  options: {
    managedProvider?: ManagedModelProvider | undefined;
    workspaceProviders?: WorkspaceProvidersPolicy | undefined;
  } = {},
) {
  const workspaceProviders = options.workspaceProviders ?? 'enabled';

  return defineRoute({
    method: 'GET',
    path: '/model-provider-catalog',
    description: 'List available model providers and models, marking models locked for a workspace',
    schema: {
      params: z.object({workspaceId: z.string().uuid()}),
      response: {
        200: modelProviderCatalogResponseSchema,
      },
    },
    handler: async (request) => {
      const {workspaceId} = request.params;
      requireWorkspaceAccess({request, workspaceId});

      return toModelProviderCatalogResponseDto(
        buildModelProviderCatalogResponse({
          managedProvider: options.managedProvider,
          workspaceProviders,
          lockedModels: await getManagedModelLocks(options.managedProvider, workspaceId),
        }),
      );
    },
  });
}
