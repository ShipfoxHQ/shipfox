import {existsSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {
  createApplicationReleasePackages,
  readPublicationClosureConfig,
  readWorkspacePackages,
} from './package-closure.js';

export function verifyPublicationClosure(repositoryRoot: string): number {
  const config = readPublicationClosureConfig(join(repositoryRoot, 'publication-closure.json'));
  const packages = createApplicationReleasePackages(
    readWorkspacePackages(repositoryRoot),
    config,
    repositoryRoot,
  );
  return packages.length;
}

function repositoryRootFromEntryPoint(entryPoint: string): string {
  let directory = dirname(fileURLToPath(entryPoint));
  while (true) {
    if (existsSync(join(directory, 'publication-closure.json'))) return directory;
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error('Could not find publication-closure.json above the package entrypoint');
    }
    directory = parent;
  }
}

function main() {
  const count = verifyPublicationClosure(repositoryRootFromEntryPoint(import.meta.url));
  process.stdout.write(`Validated a ${count}-package application publication closure.\n`);
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entryPoint === import.meta.url) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  }
}
