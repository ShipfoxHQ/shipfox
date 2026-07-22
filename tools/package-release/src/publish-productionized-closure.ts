import {type ChildProcess, spawn} from 'node:child_process';
import {globSync, readFileSync, writeFileSync} from 'node:fs';
import {constants} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {productionizeManifest} from '@shipfox/tool-utils';

type JsonRecord = Record<string, unknown>;

interface PublishProductionizedClosureOptions<T> {
  onPrepared?: (restore: () => void) => void;
  packageNames: string[];
  publish: () => Promise<T> | T;
  root: string;
}

export function findClosureManifests(root: string, packageNames: string[]): string[] {
  const manifestsByName = new Map<string, string>();
  for (const manifestPath of globSync(join(root, 'libs/**/package.json'))) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as JsonRecord;
    if (typeof manifest.name !== 'string') continue;
    if (manifestsByName.has(manifest.name)) {
      throw new Error(`Duplicate package manifest: ${manifest.name}`);
    }
    manifestsByName.set(manifest.name, manifestPath);
  }

  return packageNames.map((name) => {
    const manifestPath = manifestsByName.get(name);
    if (!manifestPath) throw new Error(`Publication closure package has no manifest: ${name}`);
    return manifestPath;
  });
}

export async function publishProductionizedClosure<T>({
  root,
  packageNames,
  publish,
  onPrepared,
}: PublishProductionizedClosureOptions<T>): Promise<T> {
  const manifestPaths = findClosureManifests(root, packageNames);
  const originalManifests = new Map(
    manifestPaths.map((manifestPath) => [manifestPath, readFileSync(manifestPath, 'utf8')]),
  );
  const restore = () => {
    for (const [manifestPath, originalManifest] of originalManifests) {
      writeFileSync(manifestPath, originalManifest);
    }
  };

  for (const [manifestPath, originalManifest] of originalManifests) {
    const manifest = JSON.parse(originalManifest) as JsonRecord;
    const productionized = productionizeManifest(manifest);
    if (productionized === manifest) continue;
    writeFileSync(manifestPath, `${JSON.stringify(productionized, null, 2)}\n`);
  }

  try {
    onPrepared?.(restore);
    return await publish();
  } finally {
    restore();
  }
}

export function publishChangesets(onSpawn?: (child: ChildProcess) => void): Promise<number> {
  return new Promise((resolvePublish, reject) => {
    const child = spawn('pnpm', ['exec', 'changeset', 'publish'], {stdio: 'inherit'});
    onSpawn?.(child);
    child.once('error', reject);
    child.once('exit', (code) => resolvePublish(code ?? 1));
  });
}

export function getRepositoryRoot(entryPoint: string): string {
  return resolve(fileURLToPath(new URL('../../..', entryPoint)));
}

async function main() {
  const repositoryRoot = getRepositoryRoot(import.meta.url);
  const closurePath = join(repositoryRoot, 'publication-closure.json');
  const {packages: packageNames} = JSON.parse(readFileSync(closurePath, 'utf8')) as {
    packages: string[];
  };
  let restore: (() => void) | undefined;
  let stopPublish: (() => void) | undefined;
  const stop = (signal: NodeJS.Signals) => {
    stopPublish?.();
    restore?.();
    process.exit(128 + constants.signals[signal]);
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const status = await publishProductionizedClosure({
      root: repositoryRoot,
      packageNames,
      publish: () =>
        publishChangesets((child) => {
          stopPublish = () => child.kill('SIGTERM');
        }),
      onPrepared: (nextRestore) => {
        restore = nextRestore;
      },
    });
    if (status !== 0) process.exitCode = status;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entryPoint === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}
