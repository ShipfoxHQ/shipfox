import {createRequire} from 'node:module';
import {startInstanceInstrumentation} from '@shipfox/node-opentelemetry';

const {version} = createRequire(import.meta.url)('../package.json') as {version: string};

// The metrics API has no proxy meter: instruments created before this preload
// completes bind to a no-op provider for the process lifetime.
await startInstanceInstrumentation({
  serviceName: 'api',
  serviceVersion: version,
  // `fetch` goes through undici, which the http instrumentation does not cover. Without it,
  // provider calls made with ky leave no client span.
  instrumentations: {
    fastify: true,
    http: true,
    undici: true,
    pg: true,
    awsSdk: true,
    pino: true,
  },
});
