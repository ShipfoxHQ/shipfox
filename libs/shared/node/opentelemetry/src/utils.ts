import type {FastifyOtelInstrumentationOpts} from '@fastify/otel';
import {isUuid} from '@shipfox/regex';

// Pure integers (numeric IDs)
const NUMERIC_SEGMENT = /^\d+$/;

export const normalizeRoutePath = (path: string): string =>
  path
    .split('/')
    .map((segment) => (isUuid(segment) || NUMERIC_SEGMENT.test(segment) ? ':id' : segment))
    .join('/');

export const fastifyRequestHook: Required<FastifyOtelInstrumentationOpts>['requestHook'] = (
  span,
  request,
) => {
  // `request.routeOptions.url` is the route template (e.g. /public/cache/:id/chunk)
  // but can leak a query string in some Fastify edge cases. Strip it.
  // Also normalise url.path which @fastify/otel incorrectly sets to request.url
  // (full URL including query string), violating the OTel spec.
  const rawRoute = (request.routeOptions.url ?? request.url).split('?')[0] ?? '';
  const route = normalizeRoutePath(rawRoute);
  const path = request.url.split('?')[0] ?? '';
  span.setAttribute('http.route', route);
  span.setAttribute('url.path', path);
};
