import {closeApp, createApp, listen} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {config, publishHooks} from '#config.js';
import {readRoutes} from '#reads.js';
import {loadSigningKey} from '#signing-key.js';
import {prepareRegistry} from '#startup.js';
import {createRegistryStorage} from '#storage/create.js';

try {
  const storage = createRegistryStorage(config.REGISTRY_STORAGE_URL);
  const signingKey = loadSigningKey({
    pem: config.REGISTRY_SIGNING_KEY,
    keyid: config.REGISTRY_SIGNING_KEY_ID,
  });
  publishHooks();
  await prepareRegistry({
    storage,
    bootstrapPath: config.REGISTRY_BOOTSTRAP_PATH,
    publicUrl: config.REGISTRY_PUBLIC_URL,
    signingKey,
  });
  await createApp({
    routes: config.REGISTRY_SERVE_READS ? readRoutes(storage) : [],
    swagger: false,
  });
  const address = await listen();
  logger().info({address, serveReads: config.REGISTRY_SERVE_READS}, 'Registry listening');

  const stopAndExit = () =>
    void closeApp().then(
      () => {
        storage.close();
        process.exit(0);
      },
      (error: unknown) => {
        logger().error({err: error}, 'Failed to stop the registry after a shutdown signal');
        process.exit(1);
      },
    );
  process.once('SIGTERM', stopAndExit);
  process.once('SIGINT', stopAndExit);
} catch (error) {
  logger().error({err: error}, 'Fatal registry startup error');
  process.exit(1);
}
