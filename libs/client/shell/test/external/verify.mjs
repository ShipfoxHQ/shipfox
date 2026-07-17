import {spawn} from 'node:child_process';
import {cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, join, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
const externalRoot = fileURLToPath(new URL('.', import.meta.url));
const fixtureTemplate = join(externalRoot, 'fixture');
const roots = ['@shipfox/client-shell', '@shipfox/client-shell-fixture-feature'];
const REGISTRY_SHIPFOX_PACKAGE_PATTERN = /^@shipfox\+[^@]+@\d/u;
const linkMode = process.argv.includes('--link');

if (process.argv.some((argument) => argument.startsWith('--') && argument !== '--link')) {
  throw new Error('Usage: node verify.mjs [--link]');
}

const {computePublicationClosure, readWorkspacePackages} = await import(
  pathToFileURL(join(repositoryRoot, 'tools/application-release/dist/package-closure.js')).href
);
const workspacePackages = readWorkspacePackages(repositoryRoot);
const closure = computePublicationClosure(workspacePackages, roots);
const temporaryRoot = await mkdtemp(join(tmpdir(), 'shipfox-client-composition-'));
const fixtureRoot = join(temporaryRoot, 'fixture');

try {
  await cp(fixtureTemplate, fixtureRoot, {recursive: true});
  const packageSpecs = linkMode
    ? linkedPackageSpecs(closure, workspacePackages)
    : await packedPackageSpecs(closure, workspacePackages, temporaryRoot);
  await configureFixture(fixtureRoot, packageSpecs);
  await run('pnpm', ['install', '--prefer-offline', '--ignore-scripts'], fixtureRoot);

  if (linkMode) await validateLinkedPackages(fixtureRoot, closure, workspacePackages);
  else {
    await validateInstalledPackages(fixtureRoot, closure, workspacePackages);
    await validateNoRegistryShipfoxPackages(fixtureRoot);
    await validateDefaultPackageResolution(fixtureRoot);
  }

  await run('pnpm', ['exec', 'vite', 'build'], fixtureRoot);
  await validateGeneratedModule(fixtureRoot);
  await run('pnpm', ['exec', 'vitest', 'run'], fixtureRoot);
  await run('pnpm', ['exec', 'tsc', '--noEmit'], fixtureRoot);

  const collision = await run('pnpm', ['exec', 'vite', 'build'], fixtureRoot, {
    capture: true,
    allowFailure: true,
    env: {SHIPFOX_COMPOSITION_COLLISION: '1'},
  });
  if (collision.code === 0) throw new Error('Collision fixture unexpectedly built successfully.');
  const collisionOutput = `${collision.stdout}\n${collision.stderr}`;
  for (const expected of [
    '/workspaces/$wid/insights',
    'fixture.toy-feature',
    'fixture.unapproved-collision',
  ]) {
    if (!collisionOutput.includes(expected)) {
      throw new Error(
        `Collision output did not include ${JSON.stringify(expected)}.\n${collisionOutput}`,
      );
    }
  }
  const collisionLine = collisionOutput
    .split('\n')
    .find((line) => line.includes('is contributed by both features'))
    ?.trim();

  process.stdout.write(
    `Verified external client composition in ${linkMode ? 'linked' : 'packed-tarball'} mode.\n`,
  );
  if (collisionLine) process.stdout.write(`Collision: ${collisionLine}\n`);
} finally {
  await rm(temporaryRoot, {recursive: true, force: true});
}

function linkedPackageSpecs(names, packages) {
  return Object.fromEntries(
    names.map((name) => {
      const workspacePackage = requiredPackage(packages, name);
      return [name, `link:${workspacePackage.directory}`];
    }),
  );
}

async function packedPackageSpecs(names, packages, root) {
  const tarballRoot = join(root, 'tarballs');
  await mkdir(tarballRoot);
  const tarballs = await mapWithConcurrency(names, 4, async (name) => {
    const workspacePackage = requiredPackage(packages, name);
    const tarball = join(tarballRoot, `${safePackageName(name)}.tgz`);
    await run('pnpm', ['pack', '--out', tarball], workspacePackage.directory, {capture: true});
    return [name, `file:${tarball}`];
  });
  return Object.fromEntries(tarballs);
}

async function configureFixture(root, packageSpecs) {
  const manifestPath = join(root, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.dependencies = {...manifest.dependencies, ...packageSpecs};
  await Promise.all([
    writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(
      join(root, 'pnpm-workspace.yaml'),
      `packages:\n  - .\noverrides:\n${Object.entries(packageSpecs)
        .map(([name, specifier]) => `  ${JSON.stringify(name)}: ${JSON.stringify(specifier)}`)
        .join('\n')}\n`,
    ),
  ]);
}

async function validateLinkedPackages(root, names, packages) {
  for (const name of names) {
    const installedRoot = await realpath(join(root, 'node_modules', name));
    const expectedRoot = await realpath(requiredPackage(packages, name).directory);
    if (installedRoot !== expectedRoot) {
      throw new Error(`Linked ${name} resolved to ${installedRoot}; expected ${expectedRoot}`);
    }
  }
}

async function validateInstalledPackages(root, names, packages) {
  const realFixtureRoot = await realpath(root);
  for (const name of names) {
    const installedManifestPath = join(root, 'node_modules', name, 'package.json');
    const installedManifest = JSON.parse(await readFile(installedManifestPath, 'utf8'));
    const expectedManifest = requiredPackage(packages, name).manifest;
    if (installedManifest.version !== expectedManifest.version) {
      throw new Error(
        `Packed ${name} has version ${installedManifest.version}; expected ${expectedManifest.version}`,
      );
    }
    const workspaceRange = findWorkspaceRange(installedManifest);
    if (workspaceRange)
      throw new Error(`Packed ${name} contains a workspace range at ${workspaceRange}`);
    validateDefaultInternalImports(name, installedManifest);
    const installedRoot = await realpath(join(root, 'node_modules', name));
    if (!installedRoot.startsWith(realFixtureRoot)) {
      throw new Error(`Packed ${name} resolved outside the external consumer`);
    }
  }
}

function validateDefaultInternalImports(name, manifest) {
  const internalImports = manifest.imports?.['#*'];
  if (internalImports === undefined) return;
  if (
    !internalImports ||
    typeof internalImports !== 'object' ||
    Array.isArray(internalImports) ||
    internalImports.default !== './dist/*'
  ) {
    throw new Error(`Packed ${name} does not map the default #* condition to ./dist/*`);
  }
}

async function validateDefaultPackageResolution(root) {
  const specifiers = [
    '@shipfox/client-shell',
    '@shipfox/client-shell/runtime',
    '@shipfox/client-shell/testing',
    '@shipfox/client-shell/vite',
    '@shipfox/client-shell-fixture-feature',
    '@shipfox/client-shell-fixture-feature/routes/insights',
  ];
  const resolution = await run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `const specifiers = ${JSON.stringify(specifiers)};
const resolved = Object.fromEntries(specifiers.map((specifier) => [specifier, import.meta.resolve(specifier)]));
process.stdout.write(JSON.stringify(resolved));`,
    ],
    root,
    {capture: true},
  );
  const resolved = JSON.parse(resolution.stdout);
  for (const specifier of specifiers) {
    const resolvedPath = fileURLToPath(resolved[specifier]);
    if (!resolvedPath.split(sep).includes('dist')) {
      throw new Error(`Packed ${specifier} resolved to source instead of dist: ${resolvedPath}`);
    }
  }
}

async function validateNoRegistryShipfoxPackages(root) {
  const virtualStore = await readdir(join(root, 'node_modules/.pnpm'), {withFileTypes: true});
  const registryPackages = virtualStore
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => REGISTRY_SHIPFOX_PACKAGE_PATTERN.test(name));
  if (registryPackages.length) {
    throw new Error(
      `External consumer used registry Shipfox packages: ${registryPackages.join(', ')}`,
    );
  }
}

async function validateGeneratedModule(root) {
  const generated = await readFile(join(root, 'src/shipfox-app.gen.ts'), 'utf8');
  for (const expected of ['/workspaces/$wid/insights', './features/override-impl']) {
    if (!generated.includes(expected)) {
      throw new Error(`Generated module did not include ${JSON.stringify(expected)}.`);
    }
  }
}

function requiredPackage(packages, name) {
  const workspacePackage = packages.get(name);
  if (!workspacePackage) throw new Error(`Missing workspace package: ${name}`);
  return workspacePackage;
}

function findWorkspaceRange(value, path = 'package.json') {
  if (typeof value === 'string') return value.startsWith('workspace:') ? path : undefined;
  if (!value || typeof value !== 'object') return undefined;
  for (const [key, child] of Object.entries(value)) {
    const found = findWorkspaceRange(child, `${path}.${key}`);
    if (found) return found;
  }
  return undefined;
}

function safePackageName(name) {
  return name.replace('@shipfox/', '').replaceAll('/', '-');
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(Array.from({length: concurrency}, () => worker()));
  return results;
}

function run(command, args, cwd, options = {}) {
  const {allowFailure = false, capture = false, env = {}} = options;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {...process.env, ...env},
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      const result = {code: code ?? 1, stdout, stderr};
      if (code === 0 || allowFailure) resolvePromise(result);
      else {
        reject(
          new Error(
            `${basename(command)} ${args.join(' ')} exited with code ${code}${capture ? `\n${stdout}\n${stderr}` : ''}`,
          ),
        );
      }
    });
  });
}
