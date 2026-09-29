import {AUTH_USER} from '@shipfox/api-auth-context';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {RegistryInterModuleClient} from '@shipfox/api-registry-dto/inter-module';
import type {RouteGroup} from '@shipfox/node-fastify';
import {buildAtRefRoute} from './at-ref.js';
import {
  buildCreateDefinitionRoute,
  type CreateDefinitionRouteOptions,
} from './create-definition.js';
import {buildGetDefinitionRoute} from './get-definition.js';
import {buildGetPackageUpdatesRoute} from './get-package-updates.js';
import {buildListDefinitionsRoute} from './list-definitions.js';
import {buildValidateDefinitionRoute} from './validate-definition.js';

export interface DefinitionRouteOptions extends Omit<CreateDefinitionRouteOptions, 'integrations'> {
  integrations: IntegrationsModuleClient;
  registry: RegistryInterModuleClient;
}

export function createDefinitionRoutes(options: DefinitionRouteOptions): RouteGroup[] {
  return [
    {
      prefix: '/definitions',
      auth: AUTH_USER,
      routes: [
        buildCreateDefinitionRoute(options),
        buildListDefinitionsRoute(options.projects),
        buildGetDefinitionRoute(options.projects),
        buildValidateDefinitionRoute(options),
        buildAtRefRoute(options),
      ],
    },
    {
      prefix: '/workspaces/:workspaceId/definitions',
      auth: AUTH_USER,
      routes: [buildGetPackageUpdatesRoute(options)],
    },
  ];
}
