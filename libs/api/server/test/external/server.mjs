import assert from 'node:assert/strict';

import {createServer, defaultModules} from '@shipfox/api-server';
import {defineRoute} from '@shipfox/node-fastify';
import {shutdownInstrumentation} from '@shipfox/node-opentelemetry';

const bootWatchdog = createWatchdog(60_000, 'Packed API server did not start within 60 seconds');

const dummyModule = {
  name: 'external-dummy',
  routes: [
    defineRoute({
      method: 'GET',
      path: '/external/dummy',
      auth: [],
      description: 'External API server composition proof route.',
      handler: () => ({dummy: true}),
    }),
  ],
};

let server;
try {
  const modules = [...(await defaultModules()), dummyModule];
  server = await createServer({modules});
  const address = await server.start();
  clearTimeout(bootWatchdog);

  const dummyResponse = await fetch(new URL('/external/dummy', address));
  assert.equal(dummyResponse.status, 200);
  assert.deepEqual(await dummyResponse.json(), {dummy: true});

  const healthResponse = await fetch(new URL('/healthz', address));
  assert.equal(healthResponse.status, 200);
} finally {
  clearTimeout(bootWatchdog);
  const shutdownWatchdog = createWatchdog(
    15_000,
    'Packed API server did not exit within 15 seconds',
  );
  try {
    await server?.stop();
  } finally {
    await shutdownInstrumentation();
    clearTimeout(shutdownWatchdog);
  }
}

function createWatchdog(timeoutMs, message) {
  const watchdog = setTimeout(() => {
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }, timeoutMs);
  watchdog.unref();
  return watchdog;
}
