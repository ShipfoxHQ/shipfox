import {AUTH_USER} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import {batchSecretsRoute} from './batch-secrets.js';
import {batchVariablesRoute} from './batch-variables.js';
import {deleteSecretRoute} from './delete-secret.js';
import {deleteVariableRoute} from './delete-variable.js';
import {getVariableRoute} from './get-variable.js';
import {listSecretsRoute} from './list-secrets.js';
import {listVariablesRoute} from './list-variables.js';
import {putSecretRoute} from './put-secret.js';
import {putVariableRoute} from './put-variable.js';

export const secretsRoutes: RouteGroup[] = [
  {
    prefix: '/workspaces/:workspaceId',
    auth: AUTH_USER,
    routes: [
      listSecretsRoute,
      putSecretRoute,
      batchSecretsRoute,
      deleteSecretRoute,
      listVariablesRoute,
      getVariableRoute,
      putVariableRoute,
      batchVariablesRoute,
      deleteVariableRoute,
    ],
  },
];
