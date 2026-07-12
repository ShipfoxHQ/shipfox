import {spawn} from 'node:child_process';
import {cp, mkdtemp, readdir, readFile, rename, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const fixtureSource = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(fixtureSource, '../..');
const fixtureRoot = await mkdtemp(join(tmpdir(), 'redact-external-'));
const tarball = join(fixtureRoot, 'redact.tgz');

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
  await run('pnpm', ['run', 'build'], packageRoot);
  await run('pnpm', ['run', 'type:emit'], packageRoot);
  await cp(fixtureSource, fixtureRoot, {
    recursive: true,
    filter: (source) => source !== import.meta.filename,
  });
  await rename(join(fixtureRoot, 'package.template.json'), join(fixtureRoot, 'package.json'));
  await run('pnpm', ['pack', '--out', tarball], packageRoot);
  await run('pnpm', ['install', '--ignore-workspace'], fixtureRoot);

  const installedRoot = join(fixtureRoot, 'node_modules/@shipfox/redact');
  const manifest = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'));
  if (manifest.private || manifest.license !== 'MIT' || manifest.dependencies) {
    throw new Error('Packed package metadata is not safe for public consumers');
  }
  if (
    manifest.repository?.url !== 'git+https://github.com/ShipfoxHQ/shipfox.git' ||
    manifest.repository?.directory !== 'libs/shared/common/redact'
  ) {
    throw new Error('Packed package repository metadata is incomplete');
  }

  const packedFiles = (await readdir(installedRoot, {recursive: true, withFileTypes: true}))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(installedRoot.length + 1))
    .sort();
  const expectedFiles = [
    'CHANGELOG.md',
    'LICENSE',
    'README.md',
    'dist/index.d.ts',
    'dist/index.d.ts.map',
    'dist/index.js',
    'dist/index.js.map',
    'package.json',
  ];
  if (JSON.stringify(packedFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(`Unexpected packed files: ${packedFiles.join(', ')}`);
  }

  await run('pnpm', ['run', 'check'], fixtureRoot);
  await run('pnpm', ['run', 'build'], fixtureRoot);
  await run('pnpm', ['run', 'start'], fixtureRoot);
} finally {
  await rm(fixtureRoot, {recursive: true, force: true});
}
