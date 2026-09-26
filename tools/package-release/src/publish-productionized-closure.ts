import {type ChildProcess, execFileSync, spawn} from 'node:child_process';
import {globSync, readFileSync, writeFileSync} from 'node:fs';
import {constants} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

import {productionizePackageManifest} from './productionized-manifest-packer.js';
import {getRepositoryRoot} from './repository-root.js';

export {getRepositoryRoot} from './repository-root.js';

type JsonRecord = Record<string, unknown>;
const packageNamePattern = /^@shipfox\/[a-z0-9][a-z0-9._-]*$/u;

interface PublishProductionizedClosureOptions<T> {
  onPrepared?: (restore: () => void) => void;
  packageNames: string[];
  publish: () => Promise<T> | T;
  root: string;
}

export interface PublishedPackageVersion {
  name: string;
  version: string;
}

export interface PublicationClosureConfig {
  packages: string[];
  roots: string[];
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

export function findPublishableToolManifests(root: string): string[] {
  return globSync(join(root, 'tools/**/package.json')).filter((manifestPath) => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as JsonRecord;
    return manifest.private !== true;
  });
}

export function loadPublicationClosure(root: string): PublicationClosureConfig {
  const closurePath = join(root, 'publication-closure.json');
  let config: unknown;
  try {
    config = JSON.parse(readFileSync(closurePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read publication closure at ${closurePath}: ${String(error)}`);
  }
  if (!isClosureConfig(config)) {
    throw new Error(`Invalid publication closure config at ${closurePath}`);
  }
  return config;
}

export function resolvePublicationManifests(root: string, packageNames: string[]): string[] {
  const manifestPaths = [
    ...findClosureManifests(root, packageNames),
    ...findPublishableToolManifests(root),
  ];
  const names = new Set<string>();
  for (const manifestPath of manifestPaths) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as JsonRecord;
    if (typeof manifest.name !== 'string') {
      throw new Error(`Publishable package has no name: ${manifestPath}`);
    }
    if (names.has(manifest.name))
      throw new Error(`Duplicate publication package: ${manifest.name}`);
    names.add(manifest.name);
  }
  return manifestPaths;
}

export async function publishProductionizedClosure<T>({
  root,
  packageNames,
  publish,
  onPrepared,
}: PublishProductionizedClosureOptions<T>): Promise<T> {
  const manifestPaths = resolvePublicationManifests(root, packageNames);
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
    const productionized = productionizePackageManifest(manifest, dirname(manifestPath));
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

export function readGitTags(root: string): ReadonlySet<string> {
  const output = execFileSync('git', ['tag', '--list'], {cwd: root, encoding: 'utf8'});
  return new Set(output.split('\n').filter(Boolean));
}

// `changeset publish` creates one local `<name>@<version>` tag for each upload npm accepted, so the
// tags added during publication are the exact versions this run published.
export function publishedVersionsFromTags(
  tagsBefore: ReadonlySet<string>,
  tagsAfter: ReadonlySet<string>,
): PublishedPackageVersion[] {
  return [...tagsAfter]
    .filter((tag) => !tagsBefore.has(tag))
    .flatMap((tag) => {
      const separator = tag.lastIndexOf('@');
      if (separator <= 0) return [];
      return [{name: tag.slice(0, separator), version: tag.slice(separator + 1)}];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function main() {
  const repositoryRoot = getRepositoryRoot(import.meta.url);
  const publishedVersionsPath = process.env.SHIPFOX_PUBLISHED_VERSIONS_PATH;
  const tagsBefore = readGitTags(repositoryRoot);
  const {packages: packageNames} = loadPublicationClosure(repositoryRoot);
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
    const published = publishedVersionsFromTags(tagsBefore, readGitTags(repositoryRoot));
    process.stdout.write(
      `Published ${published.length} package versions: ${published.map(({name, version}) => `${name}@${version}`).join(', ') || 'none'}\n`,
    );
    if (publishedVersionsPath)
      writeFileSync(publishedVersionsPath, `${JSON.stringify({packages: published}, null, 2)}\n`);
    if (status !== 0) process.exitCode = status;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

function isClosureConfig(value: unknown): value is PublicationClosureConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return isPackageList(record.roots) && isPackageList(record.packages);
}

function isPackageList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((name) => typeof name === 'string' && packageNamePattern.test(name)) &&
    new Set(value).size === value.length
  );
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entryPoint === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}
