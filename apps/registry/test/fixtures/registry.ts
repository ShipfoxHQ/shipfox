import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {db} from '#db/db.js';
import {audit} from '#db/schema/audit.js';
import {packages} from '#db/schema/packages.js';
import {usedTokens} from '#db/schema/used-tokens.js';
import {versions} from '#db/schema/versions.js';
import {FileRegistryStorage} from '#storage/file.js';

export const BOOTSTRAP_YAML = `
reserved: [shipfox-*, github]
featured: [shipfox/ticket-to-pr, shipfox/slack-thread-digest]
namespaces:
  shipfox:
    profile: {display_name: Shipfox, url: https://www.shipfox.io, verified: true}
    publishers:
      - provider: github
        repository_id: "812345678"
        repository_owner_id: "1234567"
        repository: ShipfoxHQ/shipfox
        workflow: .github/workflows/publish-packages.yml
  acme:
    status: suspended
    profile: {display_name: Acme}
`;

export async function createTemporaryRegistry() {
  const directory = await mkdtemp(join(tmpdir(), 'shipfox-registry-'));
  const storage = new FileRegistryStorage(join(directory, 'storage'));
  return {
    directory,
    storage,
    async writeBootstrap(text: string = BOOTSTRAP_YAML): Promise<string> {
      const path = join(directory, 'bootstrap.yaml');
      await writeFile(path, text);
      return path;
    },
    cleanup: () => rm(directory, {recursive: true, force: true}),
  };
}

/** Empties the tables that tests write, so each test starts from a clean database. */
export async function resetRegistryDatabase(): Promise<void> {
  await db().delete(usedTokens);
  await db().delete(audit);
  await db().delete(versions);
  await db().delete(packages);
}
