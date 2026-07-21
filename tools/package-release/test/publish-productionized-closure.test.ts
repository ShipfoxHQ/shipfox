import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {
  findClosureManifests,
  publishProductionizedClosure,
} from '../src/publish-productionized-closure.js';

type JsonRecord = Record<string, unknown>;

const roots: string[] = [];
const DUPLICATE_MANIFEST_ERROR = /Duplicate package manifest: @shipfox\/duplicate/u;
const MISSING_MANIFEST_ERROR = /Publication closure package has no manifest: @shipfox\/missing/u;
const SPAWN_FAILURE_ERROR = /spawn failed/u;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {force: true, recursive: true});
});

function createFixture(packages: Array<[string, JsonRecord]>) {
  const root = mkdtempSync(join(tmpdir(), 'shipfox-publish-'));
  roots.push(root);

  for (const [directory, manifest] of packages) {
    const packageDirectory = join(root, 'libs', directory);
    mkdirSync(packageDirectory, {recursive: true});
    writeFileSync(join(packageDirectory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  return root;
}

function closureManifest(name: string) {
  return {
    name,
    imports: {
      '#*': {
        types: './src/*',
        'workspace-source': './src/*',
        development: './src/*',
        default: './dist/*',
      },
    },
    exports: {
      '.': {
        development: {types: './src/index.ts', default: './src/index.ts'},
        default: {types: './dist/index.d.ts', default: './dist/index.js'},
      },
    },
  };
}

describe('findClosureManifests', () => {
  test('finds every requested package manifest', () => {
    const root = createFixture([['one', closureManifest('@shipfox/one')]]);

    const manifests = findClosureManifests(root, ['@shipfox/one']);

    assert.deepEqual(manifests, [join(root, 'libs', 'one', 'package.json')]);
  });

  test('rejects duplicate manifests', () => {
    const root = createFixture([
      ['one', closureManifest('@shipfox/duplicate')],
      ['two', closureManifest('@shipfox/duplicate')],
    ]);

    const findDuplicates = () => findClosureManifests(root, ['@shipfox/duplicate']);

    assert.throws(findDuplicates, DUPLICATE_MANIFEST_ERROR);
  });

  test('rejects missing manifests', () => {
    const root = createFixture([['one', closureManifest('@shipfox/one')]]);

    const findMissing = () => findClosureManifests(root, ['@shipfox/missing']);

    assert.throws(findMissing, MISSING_MANIFEST_ERROR);
  });
});

describe('publishProductionizedClosure', () => {
  test('publishes productionized manifests and restores them after success', async () => {
    const root = createFixture([['one', closureManifest('@shipfox/one')]]);
    const manifestPath = join(root, 'libs', 'one', 'package.json');
    const originalManifest = readFileSync(manifestPath, 'utf8');

    const status = await publishProductionizedClosure({
      root,
      packageNames: ['@shipfox/one'],
      publish: () => {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        assert.deepEqual(manifest.imports, {'#*': './dist/*'});
        assert.deepEqual(manifest.exports, {
          '.': {types: './dist/index.d.ts', default: './dist/index.js'},
        });
        return 0;
      },
    });

    assert.equal(status, 0);
    assert.equal(readFileSync(manifestPath, 'utf8'), originalManifest);
  });

  test('restores manifests after a non-zero publish status or publish failure', async () => {
    const root = createFixture([['one', closureManifest('@shipfox/one')]]);
    const manifestPath = join(root, 'libs', 'one', 'package.json');
    const originalManifest = readFileSync(manifestPath, 'utf8');

    const status = await publishProductionizedClosure({
      root,
      packageNames: ['@shipfox/one'],
      publish: async () => 1,
    });
    const publish = () =>
      publishProductionizedClosure({
        root,
        packageNames: ['@shipfox/one'],
        publish: () => {
          throw new Error('spawn failed');
        },
      });

    assert.equal(status, 1);
    assert.equal(readFileSync(manifestPath, 'utf8'), originalManifest);
    await assert.rejects(publish, SPAWN_FAILURE_ERROR);
    assert.equal(readFileSync(manifestPath, 'utf8'), originalManifest);
  });
});
