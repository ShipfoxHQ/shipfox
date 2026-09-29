import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {packageUpdatesResponseSchema} from '@shipfox/api-definitions-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RegistryInterModuleClient} from '@shipfox/api-registry-dto/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getPackageUpdates} from '#core/package-updates.js';
import {getDefinitionById} from '#db/definitions.js';

export interface GetPackageUpdatesRouteOptions {
  projects: ProjectsModuleClient;
  registry: Pick<RegistryInterModuleClient, 'getPackageIndex' | 'resolveVersion'>;
}

/**
 * Lives outside the definition read, so a definition page never waits on the registry.
 */
export function buildGetPackageUpdatesRoute({projects, registry}: GetPackageUpdatesRouteOptions) {
  return defineRoute({
    method: 'GET',
    path: '/:definitionId/package-updates',
    description: 'List the registry packages a definition uses and the newer versions they have',
    schema: {
      params: z.object({
        workspaceId: z.string().uuid(),
        definitionId: z.string().uuid(),
      }),
      response: {
        200: packageUpdatesResponseSchema,
      },
    },
    handler: async (request) => {
      const {workspaceId, definitionId} = request.params;
      requireWorkspaceAccess({request, workspaceId});

      const definition = await getDefinitionById(definitionId);
      if (!definition) throw notFound();
      // A definition of another workspace is reported as missing, like an unknown id.
      const {project} = await projects.getProjectById({projectId: definition.projectId});
      if (project?.workspaceId !== workspaceId) throw notFound();

      const updates = await getPackageUpdates({
        registryRefs: definition.registryRefs,
        configPath: definition.configPath,
        registry,
      });
      return {updates};
    },
  });
}

function notFound(): ClientError {
  return new ClientError('Definition not found', 'not-found', {status: 404});
}
