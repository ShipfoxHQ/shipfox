import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {RouteGroup} from '@shipfox/node-fastify';
import {createProjectRoute} from './create-project.js';
import {getProjectRoute} from './get-project.js';
import {listProjectsRoute} from './list-projects.js';

export function createProjectRoutes(integrations: IntegrationsModuleClient): RouteGroup[] {
  return [
    {
      prefix: '/projects',
      routes: [createProjectRoute(integrations), listProjectsRoute, getProjectRoute],
    },
  ];
}
