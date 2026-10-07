import {spawnSync} from 'node:child_process';
import {cp, mkdir, readdir, rm} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(packageRoot, 'src');
const outputRoot = join(packageRoot, 'dist');
const task = process.argv[2];

if (task === 'build') {
  await rm(outputRoot, {force: true, recursive: true});
  await cp(sourceRoot, outputRoot, {recursive: true});
} else if (task === 'type') {
  const sourceEntries = await readdir(sourceRoot, {withFileTypes: true});
  for (const entry of sourceEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue;
    const result = spawnSync(process.execPath, ['--check', join(sourceRoot, entry.name)], {
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
} else if (task === 'type:emit') {
  await mkdir(outputRoot, {recursive: true});
  const sourceEntries = await readdir(sourceRoot, {withFileTypes: true});
  for (const entry of sourceEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.d.ts')) continue;
    await cp(join(sourceRoot, entry.name), join(outputRoot, entry.name));
  }
} else {
  throw new Error(`Unknown package task: ${task ?? '(missing)'}`);
}
