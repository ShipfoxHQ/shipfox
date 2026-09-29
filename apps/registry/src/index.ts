import {closeApp, createApp, listen} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {createBlobStore} from '#blobs.js';
import {loadBootstrap} from '#bootstrap.js';
import {config, contentUrl, downloadTtlSeconds, publishHooks} from '#config.js';
import {closeDb} from '#db/db.js';
import {migrateRegistryDatabase} from '#db/migrations.js';
import {createPublishTokenExchange} from '#publish/exchange.js';
import {createGithubOidcVerifier} from '#publish/oidc.js';
import {createPublishTokenVerifier} from '#publish/publish-token.js';
import {createVersionPublisher} from '#publish/publish-version.js';
import {publishRoutes} from '#publish/routes.js';
import {startTokenSweep} from '#publish/token-sweep.js';
import {versionRoutes} from '#publish/version-routes.js';
import {readRoutes} from '#read/routes.js';
import {loadSigningKey, registrySigner} from '#signing-key.js';
import {createRegistryStorage} from '#storage/create.js';

try {
  const storage = createRegistryStorage(config.REGISTRY_STORAGE_URL, {contentUrl: contentUrl()});
  const signingKey = loadSigningKey({
    pem: config.REGISTRY_SIGNING_KEY,
    keyid: config.REGISTRY_SIGNING_KEY_ID,
  });
  const hooks = publishHooks();
  const bootstrap = await loadBootstrap(config.REGISTRY_BOOTSTRAP_PATH);
  createPostgresClient();
  await migrateRegistryDatabase();
  const stopTokenSweep = startTokenSweep();
  const exchange = createPublishTokenExchange({
    bootstrap,
    signingKey,
    publicUrl: config.REGISTRY_PUBLIC_URL,
    verifyOidcToken: createGithubOidcVerifier({audience: config.REGISTRY_PUBLIC_URL}),
  });
  const publishVersion = createVersionPublisher({
    bootstrap,
    signer: registrySigner(signingKey),
    verifyToken: createPublishTokenVerifier({signingKey, publicUrl: config.REGISTRY_PUBLIC_URL}),
    blobs: createBlobStore(storage),
    hooks,
  });
  await createApp({
    routes: [
      ...publishRoutes({exchange}),
      versionRoutes({publishVersion}),
      ...readRoutes({
        bootstrap,
        signingKey,
        storage,
        publicUrl: config.REGISTRY_PUBLIC_URL,
        downloadTtlSeconds: downloadTtlSeconds(),
      }),
    ],
    swagger: false,
  });
  const address = await listen();
  logger().info({address}, 'Registry listening');

  const stopAndExit = () =>
    void (async () => {
      stopTokenSweep();
      await closeApp();
      storage.close();
      closeDb();
      await closePostgresClient();
    })().then(
      () => process.exit(0),
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
