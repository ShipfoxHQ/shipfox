import {AUTH_LEASED_JOB, AUTH_USER} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import type {RouteGroup} from '@shipfox/node-fastify';
import {createAgentRuntimeConfigRoute} from './agent-runtime-config.js';
import {cancelRunRoute} from './cancel-run.js';
import {createCheckoutTokenRoute} from './checkout-token.js';
import {getRunRoute} from './get-run.js';
import {getRunAggregatesRoute} from './get-run-aggregates.js';
import {createGetStepSecretsRoute} from './get-step-secrets.js';
import {listRunAttemptsRoute} from './list-run-attempts.js';
import {listRunsRoute} from './list-runs.js';
import {createNextStepRoute} from './next-step.js';
import {createReportStepRoute} from './report-step.js';
import {rerunRunRoute} from './rerun-run.js';

const unconfiguredProjects = {
  getProjectById: () => {
    throw new Error('Projects client is not configured');
  },
  requireProjectForWorkspace: () => {
    throw new Error('Projects client is not configured');
  },
} as unknown as ProjectsModuleClient;

export function createLeaseTokenRouteGroup(
  runners: RunnersInterModuleClient,
  projects: ProjectsModuleClient = unconfiguredProjects,
): RouteGroup {
  return {
    prefix: '/runs/jobs/current',
    auth: AUTH_LEASED_JOB,
    routes: [
      createNextStepRoute(runners),
      createReportStepRoute(runners),
      createCheckoutTokenRoute(runners, projects),
      createAgentRuntimeConfigRoute(runners),
      createGetStepSecretsRoute(runners),
    ],
  };
}

export function createWorkflowRoutes(
  runners: RunnersInterModuleClient,
  projects: ProjectsModuleClient = unconfiguredProjects,
): RouteGroup[] {
  return [
    {
      prefix: '/workflows/runs',
      auth: AUTH_USER,
      routes: [
        listRunsRoute(projects),
        getRunAggregatesRoute(projects),
        listRunAttemptsRoute(projects),
        getRunRoute(projects),
        cancelRunRoute(projects),
        rerunRunRoute(projects),
      ],
    },
    createLeaseTokenRouteGroup(runners, projects),
  ];
}
