import {spawn} from 'node:child_process';
import {access, cp, mkdtemp, readFile, rename, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const fixtureSource = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(fixtureSource, '../..');
const fixtureRoot = await mkdtemp(join(tmpdir(), 'node-outbox-external-'));
const tarball = join(fixtureRoot, 'node-outbox.tgz');

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {cwd, stdio: 'inherit'});
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
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

try {
  await cp(fixtureSource, fixtureRoot, {
    recursive: true,
    filter: (source) => source !== import.meta.filename,
  });
  await rename(join(fixtureRoot, 'package.template.json'), join(fixtureRoot, 'package.json'));
  await run('pnpm', ['pack', '--out', tarball], packageRoot);
  await run('pnpm', ['install', '--ignore-workspace'], fixtureRoot);

  const installedRoot = join(fixtureRoot, 'node_modules/@shipfox/node-outbox');
  const manifest = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'));
  const workspaceRange = findWorkspaceRange(manifest);
  if (workspaceRange)
    throw new Error(`Packed manifest contains a workspace range at ${workspaceRange}`);

  const workspaceDrizzleManifest = JSON.parse(
    await readFile(resolve(packageRoot, '../drizzle/package.json'), 'utf8'),
  );
  const expectedDrizzleRange = `^${workspaceDrizzleManifest.version}`;
  const drizzleRange = manifest.dependencies?.['@shipfox/node-drizzle'];
  if (drizzleRange !== expectedDrizzleRange) {
    throw new Error(
      `Expected @shipfox/node-drizzle ${expectedDrizzleRange}, received ${drizzleRange}`,
    );
  }

  const publishedExport = manifest.exports?.['.']?.default;
  if (
    !publishedExport ||
    typeof publishedExport !== 'object' ||
    typeof publishedExport.default !== 'string' ||
    typeof publishedExport.types !== 'string'
  ) {
    throw new Error('Expected root runtime and declaration export targets');
  }

  for (const relativePath of [
    'CHANGELOG.md',
    'README.md',
    publishedExport.default,
    publishedExport.types,
  ]) {
    await access(resolve(installedRoot, relativePath));
  }

  await run('pnpm', ['run', 'check'], fixtureRoot);
  await run('pnpm', ['run', 'build'], fixtureRoot);
  await run('pnpm', ['run', 'start'], fixtureRoot);
} finally {
  await rm(fixtureRoot, {recursive: true, force: true});
}
