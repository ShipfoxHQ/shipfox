import {logger} from '@shipfox/node-opentelemetry';
import {loadBootstrap} from '#bootstrap.js';
import {config} from '#config.js';
import {reindexRegistry} from '#reindex.js';
import {createRegistryStorage} from '#storage/create.js';

const USAGE = 'Usage: node dist/cli.js reindex';

const [command] = process.argv.slice(2);
if (command !== 'reindex') {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}

const storage = createRegistryStorage(config.REGISTRY_STORAGE_URL);
try {
  const bootstrap = await loadBootstrap(config.REGISTRY_BOOTSTRAP_PATH);
  const result = await reindexRegistry({storage, bootstrap});
  for (const {key, reason} of result.skipped) {
    logger().warn({key, reason}, 'Skipped an unreadable version document');
  }
  logger().info(
    {packages: result.packages, versions: result.versions, skipped: result.skipped.length},
    'Registry indexes rebuilt',
  );
  process.exitCode = result.skipped.length === 0 ? 0 : 1;
} catch (error) {
  logger().error({err: error}, 'Registry reindex failed');
  process.exitCode = 1;
} finally {
  storage.close();
}
