import {AUTH_PROVISIONER_TOKEN, AUTH_USER} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import {createProvisionerTokenRoute} from './create-provisioner-token.js';
import {getProvisionerMeRoute} from './get-provisioner-me.js';
import {listActiveProvisionersRoute} from './list-active-provisioners.js';
import {listProvisionerTokensRoute} from './list-provisioner-tokens.js';
import {revokeProvisionerTokenRoute} from './revoke-provisioner-token.js';

export const provisionerRoutes: RouteGroup[] = [
  {
    prefix: '/workspaces/:workspaceId/provisioners/tokens',
    auth: AUTH_USER,
    routes: [listProvisionerTokensRoute, createProvisionerTokenRoute, revokeProvisionerTokenRoute],
  },
  {
    prefix: '/workspaces/:workspaceId/provisioners/active',
    auth: AUTH_USER,
    routes: [listActiveProvisionersRoute],
  },
  {
    prefix: '/provisioners',
    auth: AUTH_PROVISIONER_TOKEN,
    routes: [getProvisionerMeRoute],
  },
];
