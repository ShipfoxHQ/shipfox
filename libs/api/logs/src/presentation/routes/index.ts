import {AUTH_LEASED_JOB} from '@shipfox/api-auth-context';
import {createRawBodyPlugin, type RouteGroup} from '@shipfox/node-fastify';
import {config} from '#config.js';
import {appendLogsRoute} from './append-logs.js';

// Keep logs in their own Fastify scope so the raw NDJSON parser does not disturb
// workflow JSON routes. The body limit also bounds one-append budget overshoot.
export const logsRoutes: RouteGroup[] = [
  {
    prefix: '/runs/jobs/current',
    auth: AUTH_LEASED_JOB,
    plugins: [
      createRawBodyPlugin({
        contentType: 'application/x-ndjson',
        bodyLimit: config.LOG_APPEND_BODY_LIMIT_BYTES,
      }),
    ],
    routes: [appendLogsRoute],
  },
];
