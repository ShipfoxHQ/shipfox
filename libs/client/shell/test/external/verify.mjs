import {spawn} from 'node:child_process';
import {globSync} from 'node:fs';
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
const externalRoot = fileURLToPath(new URL('.', import.meta.url));
const fixtureTemplate = join(externalRoot, 'fixture');
const REGISTRY_SHIPFOX_PACKAGE_PATTERN = /^@shipfox\+[^@]+@\d/u;
const EXPECTED_COLLISION_DIAGNOSTIC =
  'Route "/auth/login" is contributed by both features "shipfox.auth" and "fixture.unapproved-collision". Set override: true to replace it explicitly.';
const arguments_ = process.argv.slice(2).filter((argument) => argument !== '--');
const linkMode = arguments_.includes('--link');

if (arguments_.some((argument) => argument.startsWith('--') && argument !== '--link')) {
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
const {productionizeManifest} = await import(
  pathToFileURL(join(repositoryRoot, 'tools/utils/src/productionize.js')).href
);
const config = readPublicationClosureConfig(join(repositoryRoot, 'publication-closure.json'));
const workspacePackages = readWorkspacePackages(repositoryRoot);
validatePublicationState(workspacePackages, config, repositoryRoot);
const clientRoots = config.roots.filter((root) => root.startsWith('@shipfox/client-'));
const fixtureSupportPackages = ['@shipfox/client-config'];
const consumerPackages = [...clientRoots, ...fixtureSupportPackages];
const closure = computePublicationClosure(workspacePackages, clientRoots);
const entryPoints = closure.flatMap((name) =>
  listConcreteEntryPoints(name, requiredPackage(workspacePackages, name)),
);
const consumerTypeEntryPoints = clientRoots.flatMap((name) =>
  listConcreteEntryPoints(name, requiredPackage(workspacePackages, name)),
);
const closureTypeEntryPoints = entryPoints
  .filter(({target}) => entryPointSupportsTypeResolution(target))
  .map(({specifier}) => specifier);
const runtimeEntryPoints = entryPoints
  .filter(({target}) => entryPointSupportsRuntimeImport(target))
  .map(({specifier}) => specifier);
const typeEntryPoints = consumerTypeEntryPoints
  .filter(({target}) => entryPointSupportsTypeResolution(target))
  .map(({specifier}) => specifier);
const temporaryRoot = await mkdtemp(join(tmpdir(), 'shipfox-client-composition-'));
const fixtureRoot = join(temporaryRoot, 'fixture');

try {
  await cp(fixtureTemplate, fixtureRoot, {recursive: true});
  const packageSpecs = linkMode
    ? linkedPackageSpecs(closure, workspacePackages)
    : await packedPackageSpecs(closure, workspacePackages, temporaryRoot);
  await configureFixture(fixtureRoot, consumerPackages, packageSpecs);
  await writeTypeFixture(fixtureRoot, typeEntryPoints);
  await run('pnpm', ['install', '--prefer-offline', '--ignore-scripts'], fixtureRoot, {
    capture: true,
  });

  if (linkMode) await validateLinkedPackages(fixtureRoot, consumerPackages, workspacePackages);
  else {
    await validateInstalledPackages(fixtureRoot, closure, workspacePackages);
    await validateNoRegistryShipfoxPackages(fixtureRoot);
    await validatePackageResolution(fixtureRoot, runtimeEntryPoints, {
      conditionLabel: 'default',
    });
    await validatePackageResolution(fixtureRoot, runtimeEntryPoints, {
      nodeArgs: ['--conditions=development'],
      conditionLabel: 'development',
    });
    await validateFullClosureTypeDeclarations(fixtureRoot, closureTypeEntryPoints);
  }

  await run('pnpm', ['exec', 'vite', 'build'], fixtureRoot, {capture: true});
  await validateGeneratedModule(fixtureRoot);
  await run('pnpm', ['exec', 'vitest', 'run', '--mode', 'production'], fixtureRoot, {
    capture: true,
    env: {NODE_ENV: 'production'},
  });
  await run('pnpm', ['exec', 'tsc', '--noEmit'], fixtureRoot, {capture: true});

  const collision = await run('pnpm', ['exec', 'vite', 'build'], fixtureRoot, {
    capture: true,
    allowFailure: true,
    env: {SHIPFOX_COMPOSITION_COLLISION: '1'},
  });
  if (collision.code === 0) throw new Error('Collision fixture unexpectedly built successfully.');
  const collisionOutput = `${collision.stdout}\n${collision.stderr}`;
  if (!collisionOutput.includes(EXPECTED_COLLISION_DIAGNOSTIC)) {
    throw new Error(
      `Collision output did not include the contract diagnostic:\n${EXPECTED_COLLISION_DIAGNOSTIC}\n\n${collisionOutput}`,
    );
  }

  process.stdout.write(
    `Verified the default client composition, ${closure.length} runtime packages, and ${entryPoints.length} public entry points in ${linkMode ? 'linked' : 'packed-tarball'} mode.\n`,
  );
  process.stdout.write(`Collision: ${EXPECTED_COLLISION_DIAGNOSTIC}\n`);
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
  const stagingRoot = join(root, 'packages');
  await Promise.all([
    mkdir(tarballRoot),
    mkdir(stagingRoot),
    cp(join(repositoryRoot, 'pnpm-workspace.yaml'), join(stagingRoot, 'pnpm-workspace.yaml')),
  ]);
  const tarballs = await mapWithConcurrency(names, 4, async (name) => {
    const workspacePackage = requiredPackage(packages, name);
    const tarball = join(tarballRoot, `${safePackageName(name)}.tgz`);
    await packProductionizedPackage(workspacePackage, tarball, stagingRoot);
    return [name, `file:${tarball}`];
  });
  return Object.fromEntries(tarballs);
}

async function packProductionizedPackage(workspacePackage, tarball, stagingRoot) {
  const packageRoot = join(stagingRoot, safePackageName(workspacePackage.manifest.name));
  await cp(workspacePackage.directory, packageRoot, {recursive: true});

  const manifestPath = join(packageRoot, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const productionized = productionizeManifest(manifest);
  if (productionized !== manifest) {
    await writeFile(manifestPath, `${JSON.stringify(productionized, null, 2)}\n`);
  }

  await run('pnpm', ['pack', '--out', tarball], packageRoot, {capture: true});
}

async function configureFixture(root, consumerPackages, packageSpecs) {
  const manifestPath = join(root, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const consumerDependencies = Object.fromEntries(
    consumerPackages.map((name) => [name, packageSpecs[name]]),
  );
  manifest.dependencies = {...manifest.dependencies, ...consumerDependencies};
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
    for (const packageRoot of installedPackageRoots(root, name)) {
      const installedManifest = JSON.parse(
        await readFile(join(packageRoot, 'package.json'), 'utf8'),
      );
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
      const installedRoot = await realpath(packageRoot);
      if (!installedRoot.startsWith(realFixtureRoot)) {
        throw new Error(`Packed ${name} resolved outside the external consumer`);
      }
    }
  }
}

function validateDefaultInternalImports(name, manifest) {
  const internalImports = manifest.imports?.['#*'];
  if (internalImports === undefined) return;
  if (internalImports === './dist/*') return;
  if (
    !internalImports ||
    typeof internalImports !== 'object' ||
    Array.isArray(internalImports) ||
    internalImports.default !== './dist/*'
  ) {
    throw new Error(`Packed ${name} does not map the default #* condition to ./dist/*`);
  }
}

async function validatePackageResolution(root, specifiers, {nodeArgs = [], conditionLabel}) {
  const specifiersByPackage = Map.groupBy(specifiers, packageNameFromSpecifier);
  for (const [packageName, packageSpecifiers] of specifiersByPackage) {
    for (const packageRoot of installedPackageRoots(root, packageName)) {
      const resolution = await run(
        process.execPath,
        [
          ...nodeArgs,
          '--input-type=module',
          '--eval',
          `const specifiers = ${JSON.stringify(packageSpecifiers)};
const resolved = Object.fromEntries(specifiers.map((specifier) => [specifier, import.meta.resolve(specifier)]));
process.stdout.write(JSON.stringify(resolved));`,
        ],
        packageRoot,
        {capture: true},
      );
      const resolved = JSON.parse(resolution.stdout);
      for (const specifier of packageSpecifiers) {
        const resolvedPath = fileURLToPath(resolved[specifier]);
        if (!resolvedPath.split(sep).includes('dist')) {
          throw new Error(
            `Packed ${specifier} resolved to source instead of dist under the ${conditionLabel} condition: ${resolvedPath}`,
          );
        }
      }
    }
  }
}

async function validateFullClosureTypeDeclarations(root, specifiers) {
  const typeScriptCli = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const specifiersByPackage = Map.groupBy(specifiers, packageNameFromSpecifier);
  const auditRoot = join(root, 'full-closure-types');
  const typeFixtures = [];
  let auditIndex = 0;
  for (const [packageName, packageSpecifiers] of specifiersByPackage) {
    for (const packageRoot of installedPackageRoots(root, packageName)) {
      const packageAuditRoot = join(auditRoot, String(auditIndex));
      auditIndex += 1;
      await writeTypeAudit(packageAuditRoot, packageName, packageRoot, packageSpecifiers);
      typeFixtures.push(relative(auditRoot, join(packageAuditRoot, 'types.ts')));
    }
  }

  await writeTypeAuditConfig(auditRoot, typeFixtures);
  await run(process.execPath, [typeScriptCli, '--project', 'tsconfig.json'], auditRoot, {
    capture: true,
  });
}

async function writeTypeAudit(root, packageName, packageRoot, specifiers) {
  const packageLink = join(root, 'node_modules', ...packageName.split('/'));
  await mkdir(dirname(packageLink), {recursive: true});
  await symlink(packageRoot, packageLink, 'dir');
  await writeTypeFixture(root, specifiers);
}

async function writeTypeAuditConfig(root, typeFixtures) {
  await writeFile(
    join(root, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          skipLibCheck: false,
          verbatimModuleSyntax: true,
          noEmit: true,
        },
        files: typeFixtures,
      },
      null,
      2,
    )}\n`,
  );
}

function installedPackageRoots(root, packageName) {
  const packageRoots = globSync(
    join(root, 'node_modules/.pnpm/**/node_modules', packageName),
  ).sort();
  if (!packageRoots.length) {
    throw new Error(`Packed closure package is not installed: ${packageName}`);
  }
  return packageRoots;
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
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const declaredDependencies = new Set(Object.keys(manifest.dependencies));
  const expectedImports = [
    '@shipfox/client-auth/routes/index',
    '@shipfox/client-invitations/routes/accept',
    '@shipfox/client-integrations/routes/github',
    '@shipfox/client-projects/routes/home',
    '@shipfox/client-workflows/routes/runs',
    '@shipfox/client-agent/routes/model-provider',
    '@shipfox/client-workspace-settings/routes/members',
    './features/login-override',
    './features/external-settings',
  ];
  for (const expected of expectedImports) {
    if (!generated.includes(expected)) {
      throw new Error(`Generated default composition did not include ${JSON.stringify(expected)}.`);
    }
  }

  for (const match of generated.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)) {
    const specifier = match[1];
    if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
    const packageName = packageNameFromSpecifier(specifier);
    if (!declaredDependencies.has(packageName)) {
      throw new Error(
        `Generated default composition imports undeclared package ${JSON.stringify(packageName)} from ${JSON.stringify(specifier)}.`,
      );
    }
  }
}

function packageNameFromSpecifier(specifier) {
  if (!specifier.startsWith('@')) return specifier.split('/')[0];
  return specifier.split('/').slice(0, 2).join('/');
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
    child.on('close', (code) => {
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
