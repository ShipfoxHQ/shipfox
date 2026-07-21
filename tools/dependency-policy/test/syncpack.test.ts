import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

type JsonRecord = Record<string, unknown>;

interface Fixture {
  consumerFile: string;
  directory: string;
  writePackage: (path: string, contents: JsonRecord) => Promise<void>;
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const syncpackPackage = createRequire(import.meta.url).resolve('syncpack/package.json');
const syncpackBin = join(dirname(syncpackPackage), 'index.cjs');
const syncpackConfig = join(rootDir, '.syncpackrc.json');
const directSourceError = /Direct sources require a named exception/;

describe('Syncpack catalog policy', () => {
  test('accepts catalog references, broad peers, and local workspace references', async () => {
    await withFixture(({directory}) => {
      const result = runSyncpack(directory, 'lint');

      assert.equal(result.status, 0, result.stderr);
    });
  });

  test('rejects a literal direct version', async () => {
    await withFixture(async ({consumerFile, directory, writePackage}) => {
      await writePackage(consumerFile, {
        dependencies: {
          '@fixture/local': 'workspace:*',
          zod: '^4.4.3',
        },
        devDependencies: {
          zod: 'catalog:',
        },
        name: '@fixture/consumer',
        optionalDependencies: {
          'optional-package': 'catalog:',
        },
        peerDependencies: {
          react: '^19.0.0',
        },
        version: '1.0.0',
      });

      const literalVersion = runSyncpack(directory, 'lint');

      assert.equal(literalVersion.status, 1, literalVersion.stdout);
    });
  });

  test('rejects a second direct specification', async () => {
    await withFixture(async ({directory, writePackage}) => {
      await writePackage(join(directory, 'packages/second/package.json'), {
        dependencies: {
          zod: '^4.4.3',
        },
        name: '@fixture/second',
        version: '1.0.0',
      });

      const secondSpecification = runSyncpack(directory, 'lint');

      assert.equal(secondSpecification.status, 1, secondSpecification.stdout);
    });
  });

  test('rejects a direct source without a named exception', async () => {
    await withFixture(async ({consumerFile, directory, writePackage}) => {
      await writePackage(consumerFile, {
        dependencies: {
          '@fixture/local': 'workspace:*',
          zod: 'git+https://github.com/colinhacks/zod.git',
        },
        name: '@fixture/consumer',
        version: '1.0.0',
      });

      const bannedSource = runSyncpack(directory, 'lint');

      assert.equal(bannedSource.status, 1, bannedSource.stderr);
      assert.match(bannedSource.stderr, directSourceError);
    });
  });

  test('fix restores a catalog reference without changing unrelated manifest fields', async () => {
    await withFixture(async ({consumerFile, directory, writePackage}) => {
      await writePackage(consumerFile, {
        ...catalogConsumerPackage,
        dependencies: {
          '@fixture/local': 'workspace:*',
          zod: '^4.4.3',
        },
      });

      const result = runSyncpack(directory, 'fix');
      const fixed = JSON.parse(await readFile(consumerFile, 'utf8'));

      assert.equal(result.status, 0, result.stderr);
      assert.equal(fixed.dependencies.zod, 'catalog:');
      assert.equal(fixed.dependencies['@fixture/local'], 'workspace:*');
      assert.equal(fixed.optionalDependencies['optional-package'], 'catalog:');
      assert.equal(fixed.peerDependencies.react, '^19.0.0');
    });
  });
});

const catalogConsumerPackage = {
  dependencies: {
    '@fixture/local': 'workspace:*',
    zod: 'catalog:',
  },
  devDependencies: {
    zod: 'catalog:',
  },
  name: '@fixture/consumer',
  optionalDependencies: {
    'optional-package': 'catalog:',
  },
  peerDependencies: {
    react: '^19.0.0',
  },
  version: '1.0.0',
};

async function withFixture(run: (fixture: Fixture) => Promise<void> | void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'shipfox-syncpack-'));
  const consumerFile = join(directory, 'packages/consumer/package.json');
  const writePackage = async (path: string, contents: JsonRecord) => {
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, `${JSON.stringify(contents, null, 2)}\n`);
  };

  try {
    await writeFile(
      join(directory, 'pnpm-workspace.yaml'),
      "catalog:\n  optional-package: ^1.0.0\n  zod: ^4.4.3\npackages:\n  - 'packages/*'\n",
    );
    await writePackage(join(directory, 'package.json'), {
      name: '@fixture/root',
      private: true,
      version: '1.0.0',
    });
    await writePackage(join(directory, 'packages/local/package.json'), {
      name: '@fixture/local',
      version: '1.0.0',
    });
    await writePackage(consumerFile, catalogConsumerPackage);

    await run({consumerFile, directory, writePackage});
  } finally {
    await rm(directory, {force: true, recursive: true});
  }
}

function runSyncpack(cwd: string, command: 'fix' | 'lint') {
  return spawnSync(
    process.execPath,
    [syncpackBin, command, '--config', syncpackConfig, '--no-ansi'],
    {
      cwd,
      encoding: 'utf8',
    },
  );
}
