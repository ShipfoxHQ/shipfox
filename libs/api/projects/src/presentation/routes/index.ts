import {adoptAdministrationActorGuard} from '@shipfox/api-auth-context';
import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {RouteGroup} from '@shipfox/node-fastify';
import type {FeatureFlags} from '@shipfox/node-feature-flags';
import {createAdminProjectsRoute} from './admin-projects.js';
import {createProjectRoute} from './create-project.js';
import {deleteProjectRoute} from './delete-project.js';
import {getProjectRoute} from './get-project.js';
import {createListProjectsRoute} from './list-projects.js';
import {createGetProjectAccessRoute, createUpdateProjectAccessRoute} from './project-access.js';
import {updateProjectRoute} from './update-project.js';

export function createProjectRoutes(
  integrations: IntegrationsModuleClient,
  auth: Pick<AuthInterModuleClient, 'requireAdminRole'>,
  flags: FeatureFlags,
): RouteGroup[] {
  return adoptAdministrationActorGuard([
    {
      prefix: '/projects',
      routes: [
        createProjectRoute(integrations, flags),
        createListProjectsRoute(integrations),
        getProjectRoute,
        updateProjectRoute,
        deleteProjectRoute,
        createGetProjectAccessRoute(integrations),
        createUpdateProjectAccessRoute(integrations),
      ],
    },
    {
      prefix: '/admin/projects',
      routes: [createAdminProjectsRoute(auth)],
    },
  ]);
}
