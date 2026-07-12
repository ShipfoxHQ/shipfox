import {spawn} from 'node:child_process';
import {cp, mkdtemp, readFile, realpath, rename, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const fixtureSource = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(fixtureSource, '../..');
const fixtureRoot = await mkdtemp(join(tmpdir(), 'node-drizzle-external-'));
const tarball = join(fixtureRoot, 'node-drizzle.tgz');

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

try {
  await cp(fixtureSource, fixtureRoot, {
    recursive: true,
    filter: (source) => source !== import.meta.filename,
  });
  await rename(join(fixtureRoot, 'package.template.json'), join(fixtureRoot, 'package.json'));
  await run('pnpm', ['pack', '--out', tarball], packageRoot);
  await run('pnpm', ['install', '--ignore-workspace'], fixtureRoot);

  const manifest = JSON.parse(
    await readFile(join(fixtureRoot, 'node_modules/@shipfox/node-drizzle/package.json'), 'utf8'),
  );
  const workspacePostgresManifest = JSON.parse(
    await readFile(resolve(packageRoot, '../postgres/package.json'), 'utf8'),
  );
  const expectedPostgresRange = `^${workspacePostgresManifest.version}`;
  const postgresRange = manifest.dependencies?.['@shipfox/node-postgres'];
  if (postgresRange !== expectedPostgresRange) {
    throw new Error(
      `Expected @shipfox/node-postgres ${expectedPostgresRange}, received ${postgresRange}`,
    );
  }
  const installedManifestPath = await realpath(
    join(fixtureRoot, 'node_modules/@shipfox/node-drizzle/package.json'),
  );
  const fixtureRequire = createRequire(installedManifestPath);
  const postgresEntry = fixtureRequire.resolve('@shipfox/node-postgres');
  const postgresManifest = JSON.parse(
    await readFile(resolve(dirname(postgresEntry), '../package.json'), 'utf8'),
  );
  if (postgresManifest.name !== '@shipfox/node-postgres' || postgresManifest.version === '0.0.0') {
    throw new Error('The packed package did not install a released @shipfox/node-postgres version');
  }

  await run('pnpm', ['run', 'check'], fixtureRoot);
  await run('pnpm', ['run', 'build'], fixtureRoot);
  await run('pnpm', ['run', 'start'], fixtureRoot);
} finally {
  await rm(fixtureRoot, {recursive: true, force: true});
}
