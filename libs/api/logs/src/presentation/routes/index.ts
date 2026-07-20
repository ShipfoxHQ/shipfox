import {AUTH_LEASED_JOB, AUTH_USER} from '@shipfox/api-auth-context';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {createRawBodyPlugin, type RouteGroup} from '@shipfox/node-fastify';
import {config} from '#config.js';
import {createAppendLogsRoute} from './append-logs.js';
import {readLogsRoute} from './read-logs.js';

// Keep the lease-authed append in its own Fastify scope so the raw NDJSON parser does not
// disturb the JSON read route (or workflow routes). The body limit also bounds one-append
// budget overshoot. The read route is session-authed and workspace-scoped via the row.
export function createLogsRoutes(workflows: WorkflowsModuleClient): RouteGroup[] {
  return [
    {
      prefix: '/runs/jobs/current',
      auth: AUTH_LEASED_JOB,
      plugins: [
        createRawBodyPlugin({
          contentType: 'application/x-ndjson',
          bodyLimit: config.LOG_APPEND_BODY_LIMIT_BYTES,
        }),
      ],
      routes: [createAppendLogsRoute(workflows)],
    },
    {
      prefix: '/steps',
      auth: AUTH_USER,
      routes: [readLogsRoute],
    },
  ];
}
