import {startInstanceInstrumentation} from '@shipfox/node-opentelemetry';

// The metrics API has no proxy meter: instruments created before this preload
// completes bind to a no-op provider for the process lifetime.
await startInstanceInstrumentation({
  serviceName: 'api',
  instrumentations: {fastify: true, http: true, pg: true},
});
