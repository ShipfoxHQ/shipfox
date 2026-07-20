import {AUTH_USER} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto';
import type {RouteGroup} from '@shipfox/node-fastify';
import {createManagementAccess} from './auth.js';
import {batchSecretsRoute} from './batch-secrets.js';
import {batchVariablesRoute} from './batch-variables.js';
import {deleteSecretRoute} from './delete-secret.js';
import {deleteVariableRoute} from './delete-variable.js';
import {getVariableRoute} from './get-variable.js';
import {listSecretsRoute} from './list-secrets.js';
import {listVariablesRoute} from './list-variables.js';
import {putSecretRoute} from './put-secret.js';
import {putVariableRoute} from './put-variable.js';

export function createSecretsRoutes(projects: ProjectsModuleClient): RouteGroup[] {
  const access = createManagementAccess(projects);
  return [
    {
      prefix: '/workspaces/:workspaceId',
      auth: AUTH_USER,
      routes: [
        listSecretsRoute(access),
        putSecretRoute(access),
        batchSecretsRoute(access),
        deleteSecretRoute(access),
        listVariablesRoute(access),
        getVariableRoute(access),
        putVariableRoute(access),
        batchVariablesRoute(access),
        deleteVariableRoute(access),
      ],
    },
  ];
}
