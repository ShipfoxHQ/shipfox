import {AUTH_USER} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import {
  buildCreateDefinitionRoute,
  type CreateDefinitionRouteOptions,
} from './create-definition.js';
import {getDefinitionRoute} from './get-definition.js';
import {listDefinitionsRoute} from './list-definitions.js';
import {validateDefinitionRoute} from './validate-definition.js';

export interface DefinitionRouteOptions extends CreateDefinitionRouteOptions {}

export function createDefinitionRoutes(options: DefinitionRouteOptions = {}): RouteGroup[] {
  return [
    {
      prefix: '/definitions',
      auth: AUTH_USER,
      routes: [
        buildCreateDefinitionRoute(options),
        listDefinitionsRoute,
        getDefinitionRoute,
        validateDefinitionRoute,
      ],
    },
  ];
}

export const definitionRoutes = createDefinitionRoutes();
