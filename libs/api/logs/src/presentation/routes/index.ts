import {AUTH_LEASED_JOB} from '@shipfox/api-auth-context';
import {createRawBodyPlugin, type RouteGroup} from '@shipfox/node-fastify';
import {appendLogsRoute} from './append-logs.js';

// Generous against the runner's min(2s, 256KB) flush; bounds the cap overshoot to one body.
const NDJSON_BODY_LIMIT = 1024 * 1024;

// Its own Fastify scope (separate from the workflows group that shares this
// prefix) so the raw NDJSON body parser does not disturb their JSON routes.
export const logsRoutes: RouteGroup[] = [
  {
    prefix: '/runs/jobs/current',
    auth: AUTH_LEASED_JOB,
    plugins: [
      createRawBodyPlugin({contentType: 'application/x-ndjson', bodyLimit: NDJSON_BODY_LIMIT}),
    ],
    routes: [appendLogsRoute],
  },
];
