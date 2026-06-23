import {startInstanceInstrumentation} from '@shipfox/node-opentelemetry';

// Preloaded via the entrypoint's --import flag (Dockerfile CMD and the dev
// script) so it runs before the app module graph. The metrics API has no proxy
// meter, so any instrument created at import time binds to a no-op provider
// unless the SDK has already registered the global meter provider. The await
// guarantees that registration completes before index.ts loads.
await startInstanceInstrumentation({
  serviceName: 'api',
  instrumentations: {fastify: true, http: true, pg: true},
});
