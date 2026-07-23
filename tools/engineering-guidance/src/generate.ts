import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

import {generateFromRepository, validateGeneratedBundle} from './generator.js';

const execFileAsync = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundleRoot = join(packageRoot, 'dist', 'bundle');

async function main(): Promise<void> {
  const mode = process.argv[2] ?? '--build';
  const packageManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
    version?: unknown;
  };
  if (typeof packageManifest.version !== 'string') {
    throw new Error('Engineering guidance package.json has no version');
  }

  if (mode === '--build') {
    await generateFromRepository(packageRoot, bundleRoot, packageManifest.version);
    return;
  }
  if (mode === '--ensure') {
    if (await hasGitRepository(packageRoot)) {
      await generateFromRepository(packageRoot, bundleRoot, packageManifest.version);
    } else {
      await validateGeneratedBundle(bundleRoot);
    }
    return;
  }
  if (mode === '--verify') {
    await validateGeneratedBundle(bundleRoot);
    return;
  }
  throw new Error(`Unknown engineering guidance generator mode: ${mode}`);
}

async function hasGitRepository(directory: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', directory, 'rev-parse', '--show-toplevel']);
    return true;
  } catch {
    return false;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Engineering guidance generation failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
