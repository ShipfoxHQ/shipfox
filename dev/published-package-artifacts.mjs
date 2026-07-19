import {spawn} from 'node:child_process';
import {mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {parse as parseYaml} from 'yaml';

import {
  createProductionManifestPacker,
  mapWithConcurrency,
} from './productionized-manifest-packer.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageSources = {
  '@shipfox/application-release': 'tools/application-release',
  '@shipfox/react-ui': 'libs/shared/react/ui',
  '@shipfox/redact': 'libs/shared/common/redact',
  '@shipfox/regex': 'libs/shared/common/regex',
};
const packageNames = Object.keys(packageSources);
const registryShipfoxPackagePattern = /^@shipfox\+[^@]+@\d/u;
const developmentConditionImports = ['@shipfox/regex'];

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Published package artifact validation failed: ${message}\n`);
    process.exitCode = 1;
  });
}

export async function main() {
  const [workspaceText, sourcePackageEntries] = await Promise.all([
    readFile(join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8'),
    readSourcePackages(),
  ]);
  const workspace = parseYaml(workspaceText);
  const sourcePackages = new Map(sourcePackageEntries);
  const expectedDependencies = new Map(
    [...sourcePackages].map(([name, sourcePackage]) => [
      name,
      catalogDependencies(sourcePackage.manifest, workspace),
    ]),
  );
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'shipfox-published-artifacts-'));
  const tarballRoot = join(fixtureRoot, 'tarballs');

  try {
    await buildPackageArtifacts();
    await mkdir(tarballRoot);
    const tarballs = await packPackages([...sourcePackages], tarballRoot);
    await writeConsumerManifest(fixtureRoot, tarballs, reactUiPeerDependencies(sourcePackages));
    await run('pnpm', ['install', '--prefer-offline', '--ignore-scripts'], fixtureRoot);
    await validateInstalledPackages(fixtureRoot, sourcePackages, expectedDependencies);
    await validateNoRegistryShipfoxPackages(fixtureRoot);
    await exerciseConsumer(fixtureRoot);
    process.stdout.write(`Validated ${packageNames.length} packed published package artifacts.\n`);
  } finally {
    await rm(fixtureRoot, {recursive: true, force: true});
  }
}

function readSourcePackages() {
  return Promise.all(
    Object.entries(packageSources).map(async ([name, directory]) => {
      const manifest = JSON.parse(
        await readFile(join(repositoryRoot, directory, 'package.json'), 'utf8'),
      );
      if (manifest.name !== name) throw new Error(`Expected ${directory} to define ${name}`);
      if (manifest.private === true) throw new Error(`Representative package ${name} is private`);
      return [
        name,
        {
          directory: join(repositoryRoot, directory),
          manifest,
          manifestPath: join(repositoryRoot, directory, 'package.json'),
        },
      ];
    }),
  );
}

export function catalogDependencies(manifest, workspaceConfig) {
  const dependencies = {};
  for (const [name, reference] of Object.entries(manifest.dependencies ?? {})) {
    if (typeof reference !== 'string' || !reference.startsWith('catalog:')) {
      throw new Error(`Representative package ${manifest.name} must use a catalog for ${name}`);
    }
    dependencies[name] = catalogRange(reference, name, workspaceConfig);
  }
  return dependencies;
}

export function catalogRange(reference, dependency, workspaceConfig) {
  const catalogName = reference === 'catalog:' ? 'default' : reference.slice('catalog:'.length);
  const catalog =
    catalogName === 'default' ? workspaceConfig.catalog : workspaceConfig.catalogs?.[catalogName];
  const range = catalog?.[dependency];
  if (typeof range !== 'string') {
    throw new Error(`Catalog ${catalogName} does not define ${dependency}`);
  }
  return range;
}

async function buildPackageArtifacts() {
  await run(
    'pnpm',
    ['exec', 'turbo', 'build', 'type:emit', ...packageNames.map((name) => `--filter=${name}`)],
    repositoryRoot,
  );
}

async function packPackages(packages, tarballRoot) {
  const manifestPacker = createProductionManifestPacker();
  try {
    const tarballs = await mapWithConcurrency(packages, 3, async ([name, sourcePackage]) => {
      const tarball = join(tarballRoot, `${safePackageName(name)}.tgz`);
      await manifestPacker.pack(sourcePackage.manifestPath, sourcePackage.manifest, () =>
        run('pnpm', ['pack', '--out', tarball], sourcePackage.directory, {stdio: 'ignore'}),
      );
      return [name, tarball];
    });
    return Object.fromEntries(tarballs);
  } finally {
    manifestPacker.dispose();
  }
}

async function writeConsumerManifest(root, tarballs, reactUiPeers) {
  const manifest = {
    name: 'shipfox-published-package-artifacts-consumer',
    version: '1.0.0',
    private: true,
    type: 'module',
    dependencies: consumerDependencies(tarballs, reactUiPeers),
  };
  await writeFile(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function consumerDependencies(tarballs, reactUiPeers) {
  return {
    ...Object.fromEntries(
      Object.entries(tarballs).map(([name, tarball]) => [name, `file:${tarball}`]),
    ),
    react: reactUiPeers.react,
    'react-dom': reactUiPeers['react-dom'],
  };
}

function reactUiPeerDependencies(sourcePackages) {
  const peerDependencies = sourcePackages.get('@shipfox/react-ui')?.manifest.peerDependencies;
  const react = peerDependencies?.react;
  const reactDom = peerDependencies?.['react-dom'];
  if (typeof react !== 'string' || typeof reactDom !== 'string') {
    throw new Error('@shipfox/react-ui must declare react and react-dom peer dependencies');
  }
  return {react, 'react-dom': reactDom};
}

async function validateInstalledPackages(root, packages, expectedDependencies) {
  const fixturePath = await realpath(root);
  for (const [name, sourcePackage] of packages) {
    const manifestPath = join(root, 'node_modules', name, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.version !== sourcePackage.manifest.version) {
      throw new Error(
        `Packed ${name} has version ${manifest.version}; expected ${sourcePackage.manifest.version}`,
      );
    }
    const unsupportedProtocol = findUnsupportedProtocol(manifest);
    if (unsupportedProtocol) {
      throw new Error(`Packed ${name} contains an unsupported protocol at ${unsupportedProtocol}`);
    }
    validateCatalogRanges(name, manifest, expectedDependencies);
    validatePeerRanges(name, sourcePackage.manifest, manifest);
    const packagePath = await realpath(join(root, 'node_modules', name));
    if (!packagePath.startsWith(fixturePath)) {
      throw new Error(`Packed ${name} resolved outside the external consumer`);
    }
  }
}

export function findUnsupportedProtocol(value, path = 'package.json') {
  if (typeof value === 'string') {
    return value.startsWith('catalog:') || value.startsWith('workspace:') ? path : undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  for (const [key, child] of Object.entries(value)) {
    const unsupportedProtocol = findUnsupportedProtocol(child, `${path}.${key}`);
    if (unsupportedProtocol) return unsupportedProtocol;
  }
  return undefined;
}

function validateCatalogRanges(name, manifest, expectedDependencies) {
  for (const [dependency, expectedRange] of Object.entries(expectedDependencies.get(name) ?? {})) {
    const actualRange = manifest.dependencies?.[dependency];
    if (actualRange !== expectedRange) {
      throw new Error(
        `Packed ${name} has ${dependency}@${actualRange ?? 'missing'}; expected ${expectedRange}`,
      );
    }
  }
}

function validatePeerRanges(name, sourceManifest, packedManifest) {
  const expectedPeers = sourceManifest.peerDependencies ?? {};
  for (const [peer, expectedRange] of Object.entries(expectedPeers)) {
    const actualRange = packedManifest.peerDependencies?.[peer];
    if (actualRange !== expectedRange) {
      throw new Error(
        `Packed ${name} has peer ${peer}@${actualRange ?? 'missing'}; expected ${expectedRange}`,
      );
    }
  }
}

async function validateNoRegistryShipfoxPackages(root) {
  const virtualStore = await readdir(join(root, 'node_modules/.pnpm'), {withFileTypes: true});
  const registryPackages = virtualStore
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => registryShipfoxPackagePattern.test(name));
  if (registryPackages.length > 0) {
    throw new Error(
      `External consumer used registry Shipfox packages: ${registryPackages.join(', ')}`,
    );
  }
}

async function exerciseConsumer(root) {
  const imports = ['@shipfox/redact', '@shipfox/react-ui/button'];
  await run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `const imports = ${JSON.stringify(imports)};
const modules = await Promise.all(imports.map((specifier) => import(specifier)));
if (modules.some((module) => Object.keys(module).length === 0)) throw new Error('An imported packed package has no exports.');`,
    ],
    root,
  );
  await run(
    process.execPath,
    [
      '--conditions=development',
      '--input-type=module',
      '--eval',
      `const imports = ${JSON.stringify(developmentConditionImports)};
const modules = await Promise.all(imports.map((specifier) => import(specifier)));
if (modules.some((module) => Object.keys(module).length === 0)) throw new Error('A development-condition import has no exports.');`,
    ],
    root,
  );
  await run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `const tool = await import('./node_modules/@shipfox/application-release/dist/manifest.js');
if (typeof tool.createApplicationReleaseManifest !== 'function') throw new Error('Packed application-release is missing its manifest builder.');`,
    ],
    root,
  );
}

export function safePackageName(name) {
  return name.replace('@shipfox/', '').replaceAll('/', '-');
}

function run(command, args, cwd, {stdio = 'inherit'} = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {cwd, stdio});
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${basename(command)} ${args.join(' ')} exited with code ${code}`));
    });
  });
}
