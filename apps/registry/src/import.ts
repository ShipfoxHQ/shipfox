import {resolve} from 'node:path';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {createBlobStore} from '#blobs.js';
import {loadBootstrap} from '#bootstrap.js';
import {config, publishHooks} from '#config.js';
import {closeDb} from '#db/db.js';
import {migrateRegistryDatabase} from '#db/migrations.js';
import {importBuildOutputs} from '#import/import-builds.js';
import {createVersionImporter} from '#publish/publish-version.js';
import {loadSigningKey, registrySigner} from '#signing-key.js';
import {createRegistryStorage} from '#storage/create.js';

const USAGE = `Usage: node dist/import.js <directory>

Imports every version that \`shipfox-registry-release build\` wrote below <directory>, with the
registry's configuration. Versions are signed and checked like a publish, with import provenance.
`;

const [directory, ...rest] = process.argv.slice(2);
if (directory === undefined || rest.length > 0 || directory === '--help') {
  process.stderr.write(USAGE);
  process.exit(directory === '--help' ? 0 : 1);
}

const storage = createRegistryStorage(config.REGISTRY_STORAGE_URL);
try {
  const signingKey = loadSigningKey({
    pem: config.REGISTRY_SIGNING_KEY,
    keyid: config.REGISTRY_SIGNING_KEY_ID,
  });
  const importVersion = createVersionImporter({
    bootstrap: await loadBootstrap(config.REGISTRY_BOOTSTRAP_PATH),
    signer: registrySigner(signingKey),
    blobs: createBlobStore(storage),
    hooks: publishHooks(),
  });
  createPostgresClient();
  await migrateRegistryDatabase();
  const imported = await importBuildOutputs({directory: resolve(directory), importVersion});
  for (const {namespace, name, version, created} of imported) {
    process.stdout.write(
      `${created ? 'Imported' : 'Already imported'} ${namespace}/${name}@${version}\n`,
    );
  }
} catch (error) {
  process.stderr.write(
    `Registry import failed: ${error instanceof Error ? error.message : error}\n`,
  );
  process.exitCode = 1;
} finally {
  storage.close();
  closeDb();
  await closePostgresClient();
}
