import {AUTH_LEASED_JOB} from '@shipfox/api-auth-context';
import {createRawBodyPlugin, type RouteGroup} from '@shipfox/node-fastify';
import {config} from '#config.js';
import {appendLogsRoute} from './append-logs.js';

// Its own Fastify scope (separate from the workflows group that shares this
// prefix) so the raw NDJSON body parser does not disturb their JSON routes. The
// body limit comes from config: it must hold one whole append body and bounds the
// per-job budget overshoot to one body.
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
