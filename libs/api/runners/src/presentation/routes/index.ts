import {
  AUTH_CAPACITY_BOOTSTRAP_CREDENTIAL,
  AUTH_CAPACITY_SESSION,
  AUTH_LEASED_JOB,
  AUTH_PROVISIONER_TOKEN,
  AUTH_RUNNER_REGISTRATION_TOKEN,
  AUTH_RUNNER_SESSION,
  AUTH_USER,
} from '@shipfox/api-auth-context';
import type {RouteGroup} from '@shipfox/node-fastify';
import type {CreateRunnersModuleOptions} from '#installation-provisioning.js';
import {assignCapacityRoute} from './assign-capacity.js';
import {
  attachCapacityProviderRunnerRoute,
  capacityHeartbeatRoute,
  declareCapacityRoute,
  exchangeCapacityBootstrapRoute,
  reconcileCapacityRoute,
} from './capacity-session.js';
import {createManualRegistrationTokenRoute} from './create-manual-registration-token.js';
import {createProvisionerTokenRoute} from './create-provisioner-token.js';
import {getProvisionerMeRoute} from './get-provisioner-me.js';
import {heartbeatRoute} from './heartbeat.js';
import {listActiveProvisionersRoute} from './list-active-provisioners.js';
import {listActiveRunnersRoute} from './list-active-runners.js';
import {listManualRegistrationTokensRoute} from './list-manual-registration-tokens.js';
import {listProvisionerTokensRoute} from './list-provisioner-tokens.js';
import {mintRegistrationTokensRoute} from './mint-registration-tokens.js';
import {attachProviderRunnerRoute, createPlannedCapacityRoute} from './planned-capacity.js';
import {createPollDemandRoute, pollDemandRoute} from './poll-demand.js';
import {reconcileProvisionedRunnersRoute} from './reconcile-provisioned-runners.js';
import {registerRoute} from './register.js';
import {reportProvisionedRunnersRoute} from './report-provisioned-runners.js';
import {requestJobRoute} from './request-job.js';
import {revokeManualRegistrationTokenRoute} from './revoke-manual-registration-token.js';
import {revokeProvisionerTokenRoute} from './revoke-provisioner-token.js';

const runnerOnlyRoutes: RouteGroup[] = [
  {
    prefix: '/workspaces/:workspaceId/runners/manual-registration-tokens',
    auth: AUTH_USER,
    routes: [
      listManualRegistrationTokensRoute,
      createManualRegistrationTokenRoute,
      revokeManualRegistrationTokenRoute,
    ],
  },
  {
    prefix: '/workspaces/:workspaceId/runners/active',
    auth: AUTH_USER,
    routes: [listActiveRunnersRoute],
  },
  {
    prefix: '/runners',
    auth: AUTH_RUNNER_REGISTRATION_TOKEN,
    routes: [registerRoute],
  },
  {
    prefix: '/runners/jobs',
    auth: AUTH_RUNNER_SESSION,
    routes: [requestJobRoute],
  },
  {
    prefix: '/runners/jobs',
    auth: AUTH_LEASED_JOB,
    routes: [heartbeatRoute],
  },
  {
    prefix: '/provisioners',
    auth: AUTH_PROVISIONER_TOKEN,
    routes: [
      pollDemandRoute,
      createPlannedCapacityRoute,
      attachProviderRunnerRoute,
      assignCapacityRoute,
      mintRegistrationTokensRoute,
      reportProvisionedRunnersRoute,
      reconcileProvisionedRunnersRoute,
    ],
  },
];

const capacityRoutes: RouteGroup[] = [
  {
    prefix: '/capacity',
    auth: AUTH_CAPACITY_BOOTSTRAP_CREDENTIAL,
    routes: [exchangeCapacityBootstrapRoute],
  },
  {
    prefix: '/capacity',
    auth: AUTH_CAPACITY_SESSION,
    routes: [
      declareCapacityRoute,
      attachCapacityProviderRunnerRoute,
      capacityHeartbeatRoute,
      reconcileCapacityRoute,
    ],
  },
];

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

export function createRunnerRoutes(options: CreateRunnersModuleOptions = {}): RouteGroup[] {
  return [
    ...runnerOnlyRoutes.map((route) =>
      route.routes.includes(pollDemandRoute)
        ? {
            ...route,
            routes: route.routes.map((r) =>
              r === pollDemandRoute ? createPollDemandRoute(options) : r,
            ),
          }
        : route,
    ),
    ...provisionerRoutes,
    ...capacityRoutes,
  ];
}

export const runnerRoutes: RouteGroup[] = [...runnerOnlyRoutes, ...provisionerRoutes];
