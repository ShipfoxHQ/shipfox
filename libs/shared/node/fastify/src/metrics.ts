import {instanceMetrics} from '@shipfox/node-opentelemetry';
import type {FastifyInstance, FastifyRequest} from 'fastify';

interface RequestMetricLabels {
  [key: string]: string;
  method: string;
  route: string;
  status_code: string;
}

interface ActiveRequestMetricLabels {
  [key: string]: string;
  method: string;
  route: string;
}

const HTTP_METHODS = new Set([
  'CONNECT',
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
  'TRACE',
]);

const meter = instanceMetrics.getMeter('node-fastify');

const requestCount = meter.createCounter<RequestMetricLabels>('fastify_request', {
  description: 'Fastify requests completed by route, method, and response status',
});
const requestDuration = meter.createHistogram<RequestMetricLabels>('fastify_request_duration', {
  description: 'Fastify request duration by route, method, and response status',
  unit: 'ms',
  advice: {explicitBucketBoundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]},
});
const activeRequests = meter.createUpDownCounter<ActiveRequestMetricLabels>(
  'fastify_active_request',
  {description: 'Fastify requests currently being processed'},
);
const readiness = meter.createGauge('fastify_readiness', {
  description: 'Whether the Fastify application is ready to serve requests',
});

export function registerFastifyMetrics(app: FastifyInstance): void {
  const requests = new WeakMap<
    FastifyRequest,
    {labels: ActiveRequestMetricLabels; start: number}
  >();

  app.addHook('onRequest', (request, _reply, done) => {
    const labels = requestLabels(request);
    requests.set(request, {labels, start: performance.now()});
    activeRequests.add(1, labels);
    done();
  });

  app.addHook('onResponse', (request, reply, done) => {
    finishRequest(request, String(reply.statusCode));
    done();
  });

  app.addHook('onRequestAbort', (request, done) => {
    finishRequest(request, 'aborted');
    done();
  });

  app.addHook('onReady', (done) => {
    recordFastifyReadiness(true);
    done();
  });

  app.addHook('onClose', (_instance, done) => {
    recordFastifyReadiness(false);
    done();
  });

  function finishRequest(request: FastifyRequest, statusCode: string): void {
    const active = requests.get(request);
    if (!active) return;
    requests.delete(request);
    activeRequests.add(-1, active.labels);
    const labels = {...active.labels, status_code: statusCode};
    requestCount.add(1, labels);
    requestDuration.record(performance.now() - active.start, labels);
  }
}

export function recordFastifyReadiness(ready: boolean): void {
  readiness.record(ready ? 1 : 0);
}

function requestLabels(request: FastifyRequest): ActiveRequestMetricLabels {
  const route = request.routeOptions.url?.split('?', 1)[0] || 'unmatched';
  return {
    method: HTTP_METHODS.has(request.method) ? request.method : 'OTHER',
    route,
  };
}
