import assert from 'node:assert/strict';
import {access, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {packProductionizedPackage} from '../src/productionized-manifest-packer.js';

const roots: string[] = [];
const SOURCE_PATH_PATTERN = /src\//u;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {force: true, recursive: true})));
});

test('packs a staged production manifest without changing the source package', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shipfox-productionized-manifest-packer-'));
  roots.push(root);
  const sourceDirectory = join(root, 'source');
  const stagingRoot = join(root, 'staging');
  const sourceManifest = `${JSON.stringify(
    {
      name: '@shipfox/example',
      dependencies: {ajv: 'catalog:', '@shipfox/runtime': 'workspace:*'},
      devDependencies: {'@shipfox/biome': 'workspace:*'},
      imports: {'#*': {development: './src/*', default: './dist/*'}},
    },
    null,
    2,
  )}\n`;
  await mkdir(sourceDirectory, {recursive: true});
  await mkdir(stagingRoot, {recursive: true});
  await Promise.all([
    mkdir(join(sourceDirectory, '.turbo'), {recursive: true}),
    mkdir(join(sourceDirectory, 'dist'), {recursive: true}),
    mkdir(join(sourceDirectory, 'node_modules'), {recursive: true}),
  ]);
  await Promise.all([
    writeFile(join(sourceDirectory, '.turbo/cache'), 'cache'),
    writeFile(join(sourceDirectory, 'dist/index.js'), 'export {};'),
    writeFile(join(sourceDirectory, 'node_modules/dependency'), 'dependency'),
    writeFile(join(sourceDirectory, 'package.json'), sourceManifest),
  ]);

  const result = await packProductionizedPackage({
    dependencyContext: {
      workspaceConfig: {catalog: {ajv: '^8.18.0'}},
      workspaceVersions: new Map([['@shipfox/runtime', '1.2.3']]),
    },
    manifest: JSON.parse(sourceManifest),
    packArtifact: async (stagedDirectory) => {
      const stagedManifest = JSON.parse(
        await readFile(join(stagedDirectory, 'package.json'), 'utf8'),
      );
      return {
        distContents: await readFile(join(stagedDirectory, 'dist/index.js'), 'utf8'),
        devDependencies: stagedManifest.devDependencies,
        dependencies: stagedManifest.dependencies,
        imports: stagedManifest.imports,
        copiedNodeModules: await pathExists(join(stagedDirectory, 'node_modules')),
        copiedTurboCache: await pathExists(join(stagedDirectory, '.turbo')),
      };
    },
    sourceDirectory,
    stagingRoot,
  });

  assert.doesNotMatch(JSON.stringify(result.imports), SOURCE_PATH_PATTERN);
  assert.equal(result.devDependencies, undefined);
  assert.deepEqual(result.dependencies, {ajv: '^8.18.0', '@shipfox/runtime': '1.2.3'});
  assert.equal(result.distContents, 'export {};');
  assert.equal(result.copiedNodeModules, false);
  assert.equal(result.copiedTurboCache, false);
  assert.equal(await readFile(join(sourceDirectory, 'package.json'), 'utf8'), sourceManifest);
});

test('removes test-only internal imports from production manifests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shipfox-productionized-manifest-packer-'));
  roots.push(root);
  const sourceDirectory = join(root, 'source');
  const stagingRoot = join(root, 'staging');
  await mkdir(sourceDirectory, {recursive: true});
  await mkdir(stagingRoot, {recursive: true});
  await Promise.all([
    writeFile(join(sourceDirectory, 'dist.js'), 'export {};'),
    writeFile(
      join(sourceDirectory, 'package.json'),
      JSON.stringify({name: '@shipfox/example', imports: {'#test/*': './test/*'}}),
    ),
  ]);

  const result = await packProductionizedPackage({
    dependencyContext: {workspaceConfig: {}, workspaceVersions: new Map()},
    manifest: {name: '@shipfox/example'},
    packArtifact: async (stagedDirectory) =>
      JSON.parse(await readFile(join(stagedDirectory, 'package.json'), 'utf8')) as Record<
        string,
        unknown
      >,
    sourceDirectory,
    stagingRoot,
  });

  assert.deepEqual(result.imports, {});
});

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
