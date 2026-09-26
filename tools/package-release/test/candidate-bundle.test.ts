import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parse} from 'yaml';

import {
  type CandidateManifest,
  candidateTarballName,
  type PackPackage,
  packCandidateBundle,
  sha512Integrity,
} from '../src/candidate-bundle.js';

const sha = 'a'.repeat(40);
const publicUrl = 'https://candidates.example.test/';
const roots: string[] = [];
const PACK_FAILURE_ERROR = /pack failed/u;
const SHORT_SHA_ERROR = /full commit SHA/u;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {force: true, recursive: true});
});

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), 'shipfox-candidate-'));
  roots.push(root);
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'catalog:\n  zod: ^4.4.3\n');
  writeManifest(join(root, 'libs', 'api-server'), {
    name: '@shipfox/api-server',
    version: '33.2.1',
    exports: {'.': {development: './src/index.ts', default: './dist/index.js'}},
    dependencies: {'@shipfox/api-auth': 'workspace:*', zod: 'catalog:'},
    devDependencies: {'@shipfox/biome': 'workspace:*'},
  });
  writeManifest(join(root, 'libs', 'api-auth'), {name: '@shipfox/api-auth', version: '33.2.1'});
  writeManifest(join(root, 'tools', 'docker'), {name: '@shipfox/docker', version: '1.0.3'});
  return root;
}

function writeManifest(directory: string, manifest: Record<string, unknown>) {
  mkdirSync(directory, {recursive: true});
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

// Stands in for `pnpm pack`: writes a tarball named like pnpm's, containing the staged manifest.
const fakePack: PackPackage = async (packageDirectory, destination) => {
  const manifest = await readFile(join(packageDirectory, 'package.json'), 'utf8');
  const {name, version} = JSON.parse(manifest);
  await writeFile(join(destination, candidateTarballName(name, version)), manifest);
};

describe('packCandidateBundle', () => {
  test('writes the manifest and overrides for every packed package', async () => {
    const root = createRepository();
    const outputDirectory = join(root, 'out');

    await packCandidateBundle({
      root,
      packageNames: ['@shipfox/api-server', '@shipfox/api-auth'],
      outputDirectory,
      sha,
      publicUrl,
      ciRun: 'https://github.com/ShipfoxHQ/shipfox/actions/runs/1',
      createdAt: new Date('2026-09-26T12:00:00Z'),
      pack: fakePack,
    });

    const manifest: CandidateManifest = JSON.parse(
      readFileSync(join(outputDirectory, 'manifest.json'), 'utf8'),
    );
    const tarball = readFileSync(join(outputDirectory, 'shipfox-api-server-33.2.1.tgz'));
    assert.deepEqual(
      {...manifest, packages: manifest.packages.map(({name, file}) => ({name, file}))},
      {
        schemaVersion: 1,
        sha,
        createdAt: '2026-09-26T12:00:00.000Z',
        ciRun: 'https://github.com/ShipfoxHQ/shipfox/actions/runs/1',
        packages: [
          {name: '@shipfox/api-auth', file: 'shipfox-api-auth-33.2.1.tgz'},
          {name: '@shipfox/api-server', file: 'shipfox-api-server-33.2.1.tgz'},
          {name: '@shipfox/docker', file: 'shipfox-docker-1.0.3.tgz'},
        ],
      },
    );
    assert.equal(manifest.packages[1]?.version, '33.2.1');
    assert.equal(manifest.packages[1]?.integrity, sha512Integrity(tarball));
    assert.deepEqual(parse(readFileSync(join(outputDirectory, 'overrides.yaml'), 'utf8')), {
      overrides: {
        '@shipfox/api-auth': `https://candidates.example.test/candidates/${sha}/shipfox-api-auth-33.2.1.tgz`,
        '@shipfox/api-server': `https://candidates.example.test/candidates/${sha}/shipfox-api-server-33.2.1.tgz`,
        '@shipfox/docker': `https://candidates.example.test/candidates/${sha}/shipfox-docker-1.0.3.tgz`,
      },
    });
  });

  test('packs productionized manifests with resolved references, then restores the tree', async () => {
    const root = createRepository();
    const manifestPath = join(root, 'libs', 'api-server', 'package.json');
    const original = readFileSync(manifestPath, 'utf8');
    const outputDirectory = join(root, 'out');

    await packCandidateBundle({
      root,
      packageNames: ['@shipfox/api-server', '@shipfox/api-auth'],
      outputDirectory,
      sha,
      publicUrl,
      pack: fakePack,
    });

    const packed = JSON.parse(
      readFileSync(join(outputDirectory, 'shipfox-api-server-33.2.1.tgz'), 'utf8'),
    );
    assert.equal(packed.version, '33.2.1');
    assert.deepEqual(packed.dependencies, {'@shipfox/api-auth': '33.2.1', zod: '^4.4.3'});
    assert.equal(packed.devDependencies, undefined);
    assert.equal(readFileSync(manifestPath, 'utf8'), original);
  });

  test('restores the source tree when packing fails', async () => {
    const root = createRepository();
    const manifestPath = join(root, 'libs', 'api-server', 'package.json');
    const original = readFileSync(manifestPath, 'utf8');

    const pack = () =>
      packCandidateBundle({
        root,
        packageNames: ['@shipfox/api-server', '@shipfox/api-auth'],
        outputDirectory: join(root, 'out'),
        sha,
        publicUrl,
        pack: () => Promise.reject(new Error('pack failed')),
      });

    await assert.rejects(pack, PACK_FAILURE_ERROR);
    assert.equal(readFileSync(manifestPath, 'utf8'), original);
  });

  test('rejects an abbreviated commit SHA', async () => {
    const root = createRepository();

    const pack = () =>
      packCandidateBundle({
        root,
        packageNames: ['@shipfox/api-server'],
        outputDirectory: join(root, 'out'),
        sha: 'abc1234',
        publicUrl,
        pack: fakePack,
      });

    await assert.rejects(pack, SHORT_SHA_ERROR);
  });
});
