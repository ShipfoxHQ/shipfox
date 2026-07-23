import {spawn} from 'node:child_process';
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const packageRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fixtureRoot = await mkdtemp(join(tmpdir(), 'shipfox-worktree-services-external-'));
const tarball = join(fixtureRoot, 'shipfox-worktree-services.tgz');
const fakeBin = join(fixtureRoot, 'bin');
const dockerLog = join(fixtureRoot, 'docker.log');

try {
  await mkdir(fakeBin);
  await writeFile(
    join(fakeBin, 'docker'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FAKE_DOCKER_LOG"\n',
  );
  await chmod(join(fakeBin, 'docker'), 0o755);
  await writeFile(
    join(fixtureRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'shipfox-worktree-services-external-consumer',
        version: '1.0.0',
        private: true,
        type: 'module',
        dependencies: {'@shipfox/worktree-services': `file:${tarball}`},
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(fixtureRoot, 'pnpm-workspace.yaml'), 'packages:\n  - .\n');
  await writeFile(join(fixtureRoot, 'compose.yml'), 'services:\n  postgres:\n  temporal:\n');
  await mkdir(join(fixtureRoot, 'dev'));
  await writeFile(
    join(fixtureRoot, 'dev/worktree-services.config.mjs'),
    `import {defineWorktreeServices, standardAppEnv, standardPorts} from '@shipfox/worktree-services';

export default defineWorktreeServices({
  composeFile: 'compose.yml',
  ports: standardPorts,
  compose: {services: ['postgres', 'temporal'], initCommands: []},
  appEnv({ports}) {
    return {...standardAppEnv(ports), FIXTURE_API_PORT: String(ports.api)};
  },
});
`,
  );

  await run('pnpm', ['pack', '--out', tarball], packageRoot, process.env);
  await run(
    'pnpm',
    ['install', '--frozen-lockfile=false', '--ignore-scripts'],
    fixtureRoot,
    process.env,
  );

  const installedPackageRoot = join(fixtureRoot, 'node_modules/@shipfox/worktree-services');
  const installedManifest = JSON.parse(
    await readFile(join(installedPackageRoot, 'package.json'), 'utf8'),
  );
  if (installedManifest.private !== false) throw new Error('Packed package is not public.');
  if (installedManifest.exports['.'].default.default !== './dist/index.js') {
    throw new Error('Default package export does not point to compiled JavaScript.');
  }
  if (installedManifest.exports['.']['workspace-source'].default !== './src/index.ts') {
    throw new Error('Workspace source export does not point to TypeScript source.');
  }
  if (await pathExists(join(installedPackageRoot, 'src'))) {
    throw new Error('Packed external package includes source files.');
  }

  const env = {
    ...process.env,
    FAKE_DOCKER_LOG: dockerLog,
    HOME: fixtureRoot,
    PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    SHIPFOX_PORT_LEASES_FILE: join(fixtureRoot, 'leases.json'),
    SHIPFOX_PORT_RANGE_START: '31000',
    SHIPFOX_PORT_RANGE_END: '31099',
  };
  const cli = join(fixtureRoot, 'node_modules/.bin/shipfox-worktree-services');
  await run(
    cli,
    ['up', '--workspace', fixtureRoot, '--config', 'dev/worktree-services.config.mjs'],
    fixtureRoot,
    env,
  );

  const appEnv = await readFile(join(fixtureRoot, '.context/local-services/env'), 'utf8');
  if (!appEnv.includes('FIXTURE_API_PORT="31001"')) {
    throw new Error('Packed CLI did not load the external two-service config.');
  }
  const composeEnv = await readFile(
    join(fixtureRoot, '.context/local-services/compose.env'),
    'utf8',
  );
  if (!composeEnv.includes('SHIPFOX_API_PORT=31001')) {
    throw new Error('Packed CLI did not write the standard API port.');
  }
  if (!composeEnv.includes('SHIPFOX_OTEL_INSTANCE_METRICS_PORT=31008')) {
    throw new Error('Packed CLI did not write the standard OTel port.');
  }
  const dockerLogContents = await readFile(dockerLog, 'utf8');
  if (!dockerLogContents.includes('compose --env-file') || !dockerLogContents.includes('up -d')) {
    throw new Error('Packed CLI did not invoke Docker Compose.');
  }

  await run(
    cli,
    ['destroy', '--workspace', fixtureRoot, '--config', 'dev/worktree-services.config.mjs'],
    fixtureRoot,
    env,
  );
  if (await pathExists(join(fixtureRoot, '.context/local-services'))) {
    throw new Error('Destroy did not remove generated workspace state.');
  }
  const registry = JSON.parse(await readFile(join(fixtureRoot, 'leases.json'), 'utf8'));
  if (Object.keys(registry.leases).length !== 0)
    throw new Error('Destroy did not release the port lease.');

  process.stdout.write(
    'Verified the packed CLI, exports, config loading, Compose lifecycle, and cleanup.\n',
  );
} finally {
  await rm(fixtureRoot, {recursive: true, force: true});
}

function run(command, args, cwd, env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {cwd, env, stdio: 'inherit'});
    child.once('error', rejectPromise);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function pathExists(path) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (error?.code === 'EISDIR') return true;
    return false;
  }
}
