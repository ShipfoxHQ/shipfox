import {spawn} from 'node:child_process';
import {globSync} from 'node:fs';
import {cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
const externalRoot = fileURLToPath(new URL('.', import.meta.url));
const fixtureTemplate = join(externalRoot, 'fixture');
const REGISTRY_SHIPFOX_PACKAGE_PATTERN = /^@shipfox\+[^@]+@\d/u;
const linkMode = process.argv.includes('--link');

if (process.argv.some((argument) => argument.startsWith('--') && argument !== '--link')) {
  throw new Error('Usage: node verify.mjs [--link]');
}

const {
  computePublicationClosure,
  entryPointSupportsRuntimeImport,
  entryPointSupportsTypeResolution,
  listPublicPackageEntryPoints,
  readPublicationClosureConfig,
  readWorkspacePackages,
  validatePublicationState,
} = await import(
  pathToFileURL(join(repositoryRoot, 'tools/application-release/dist/package-closure.js')).href
);
const config = readPublicationClosureConfig(join(repositoryRoot, 'publication-closure.json'));
const workspacePackages = readWorkspacePackages(repositoryRoot);
validatePublicationState(workspacePackages, config, repositoryRoot);
const clientRoots = config.roots.filter((root) => root.startsWith('@shipfox/client-'));
const closure = computePublicationClosure(workspacePackages, clientRoots);
const entryPoints = closure.flatMap((name) =>
  listConcreteEntryPoints(name, requiredPackage(workspacePackages, name)),
);
const runtimeEntryPoints = entryPoints
  .filter(({target}) => entryPointSupportsRuntimeImport(target))
  .map(({specifier}) => specifier);
const typeEntryPoints = entryPoints
  .filter(({target}) => entryPointSupportsTypeResolution(target))
  .map(({specifier}) => specifier);
const temporaryRoot = await mkdtemp(join(tmpdir(), 'shipfox-client-composition-'));
const fixtureRoot = join(temporaryRoot, 'fixture');

try {
  await cp(fixtureTemplate, fixtureRoot, {recursive: true});
  const packageSpecs = linkMode
    ? linkedPackageSpecs(closure, workspacePackages)
    : await packedPackageSpecs(closure, workspacePackages, temporaryRoot);
  await configureFixture(fixtureRoot, packageSpecs);
  await writeTypeFixture(fixtureRoot, typeEntryPoints);
  await run('pnpm', ['install', '--prefer-offline', '--ignore-scripts'], fixtureRoot);

  if (linkMode) await validateLinkedPackages(fixtureRoot, closure, workspacePackages);
  else {
    await validateInstalledPackages(fixtureRoot, closure, workspacePackages);
    await validateNoRegistryShipfoxPackages(fixtureRoot);
    await validateDefaultPackageResolution(fixtureRoot, runtimeEntryPoints);
  }

  await run('pnpm', ['exec', 'vite', 'build'], fixtureRoot);
  await run('pnpm', ['exec', 'tsc', '--noEmit'], fixtureRoot);

  process.stdout.write(
    `Verified ${closure.length} external client runtime packages and ${entryPoints.length} public entry points in ${linkMode ? 'linked' : 'packed-tarball'} mode.\n`,
  );
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

async function writeTypeFixture(root, entryPoints) {
  await writeFile(
    join(root, 'types.ts'),
    `${entryPoints
      .map(
        (specifier, index) => `import type * as Entry${index} from ${JSON.stringify(specifier)};`,
      )
      .join('\n')}\n\n${entryPoints
      .map((_, index) => `void (0 as unknown as typeof Entry${index});`)
      .join('\n')}\n`,
  );
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

async function validateDefaultPackageResolution(root, specifiers) {
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

function requiredPackage(packages, name) {
  const workspacePackage = packages.get(name);
  if (!workspacePackage) throw new Error(`Missing workspace package: ${name}`);
  return workspacePackage;
}

function listConcreteEntryPoints(name, workspacePackage) {
  return listPublicPackageEntryPoints(name, workspacePackage.manifest.exports).flatMap(
    (entryPoint) => {
      if (!entryPoint.specifier.includes('*')) return entryPoint;
      return concretePatternEntryPoints(entryPoint, workspacePackage.directory);
    },
  );
}

function concretePatternEntryPoints(entryPoint, packageDirectory) {
  const runtimeTarget = defaultRuntimeTarget(entryPoint.target);
  if (!runtimeTarget?.includes('*')) {
    throw new Error(
      `Wildcard export ${entryPoint.specifier} must define a default JavaScript target.`,
    );
  }

  const targetPattern = runtimeTarget.slice(2);
  const globPattern = targetPattern.replace('*', '**/*');
  const capturePattern = new RegExp(
    `^${targetPattern
      .split('*')
      .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
      .join('(.+)')}$`,
  );
  const concreteEntryPoints = globSync(join(packageDirectory, globPattern)).map((path) => {
    const relativePath = relative(packageDirectory, path).split(sep).join('/');
    const match = capturePattern.exec(relativePath);
    if (!match) {
      throw new Error(
        `Wildcard export ${entryPoint.specifier} resolved ${relativePath} outside ${runtimeTarget}.`,
      );
    }
    return {...entryPoint, specifier: entryPoint.specifier.replace('*', match[1])};
  });

  if (!concreteEntryPoints.length) {
    throw new Error(
      `Wildcard export ${entryPoint.specifier} did not resolve any files matching ${runtimeTarget}.`,
    );
  }

  return concreteEntryPoints;
}

function defaultRuntimeTarget(target) {
  if (typeof target === 'string') return target.endsWith('.js') ? target : undefined;
  if (!target || typeof target !== 'object' || Array.isArray(target)) return undefined;
  const defaultTarget = target.default;
  return defaultTarget === undefined ? undefined : defaultRuntimeTarget(defaultTarget);
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
