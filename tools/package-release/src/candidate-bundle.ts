import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {constants} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {stringify} from 'yaml';

import {
  mapWithConcurrency,
  type PackageDependencyContext,
  productionizeDependencyReferences,
  run,
} from './productionized-manifest-packer.js';
import {readPackageDependencyContext} from './publication-preflight.js';
import {
  getRepositoryRoot,
  loadPublicationClosure,
  publishProductionizedClosure,
  resolvePublicationManifests,
} from './publish-productionized-closure.js';

export interface CandidatePackage {
  file: string;
  integrity: string;
  name: string;
  version: string;
}

export interface CandidateManifest {
  ciRun?: string;
  createdAt: string;
  packages: CandidatePackage[];
  schemaVersion: 1;
  sha: string;
}

export type PackPackage = (packageDirectory: string, destination: string) => Promise<void>;

interface PackCandidateBundleOptions {
  ciRun?: string | undefined;
  createdAt?: Date;
  onPrepared?: ((restore: () => void) => void) | undefined;
  outputDirectory: string;
  pack?: PackPackage;
  packageNames: string[];
  publicUrl: string;
  root: string;
  sha: string;
}

export const candidateManifestFile = 'manifest.json';
export const candidateOverridesFile = 'overrides.yaml';
const fullShaPattern = /^[0-9a-f]{40}$/u;
const trailingSlashesPattern = /\/+$/u;
const scopeMarkerPattern = /^@/u;

export function candidatePrefix(sha: string): string {
  return `candidates/${sha}`;
}

export function candidateUrl(publicUrl: string, sha: string, file: string): string {
  return `${publicUrl.replace(trailingSlashesPattern, '')}/${candidatePrefix(sha)}/${file}`;
}

// Mirrors the file name `pnpm pack` writes: scope marker dropped, scope separator replaced.
export function candidateTarballName(name: string, version: string): string {
  return `${name.replace(scopeMarkerPattern, '').replace('/', '-')}-${version}.tgz`;
}

export function sha512Integrity(content: Buffer): string {
  return `sha512-${createHash('sha512').update(content).digest('base64')}`;
}

export function renderCandidateOverrides(manifest: CandidateManifest, publicUrl: string): string {
  const overrides = Object.fromEntries(
    manifest.packages.map(({name, file}) => [name, candidateUrl(publicUrl, manifest.sha, file)]),
  );
  return stringify({overrides});
}

export function pnpmPack(signal?: AbortSignal): PackPackage {
  return (packageDirectory, destination) =>
    run('pnpm', ['pack', '--pack-destination', destination], packageDirectory, {
      signal,
      // pnpm lists every packed file on stdout; keep stderr for failures.
      stdio: ['ignore', 'ignore', 'inherit'],
    });
}

/**
 * Packs the publication closure with the same productionized manifests `release:publish` uses,
 * without rewriting versions, and writes `manifest.json` and `overrides.yaml` beside the tarballs.
 * Source manifests are restored before this resolves, even when packing fails.
 */
export async function packCandidateBundle({
  root,
  packageNames,
  outputDirectory,
  sha,
  publicUrl,
  ciRun,
  createdAt = new Date(),
  pack = pnpmPack(),
  onPrepared,
}: PackCandidateBundleOptions): Promise<CandidateManifest> {
  if (!fullShaPattern.test(sha)) throw new Error(`Candidate SHA must be a full commit SHA: ${sha}`);
  await mkdir(outputDirectory, {recursive: true});
  const manifestPaths = resolvePublicationManifests(root, packageNames);
  const dependencyContext = await readPackageDependencyContext(root);

  const packages = await publishProductionizedClosure({
    root,
    packageNames,
    onPrepared,
    publish: () =>
      mapWithConcurrency(manifestPaths, 4, (manifestPath) =>
        packOne({manifestPath, outputDirectory, pack, dependencyContext}),
      ),
  });
  packages.sort((left, right) => left.name.localeCompare(right.name));

  const manifest: CandidateManifest = {
    schemaVersion: 1,
    sha,
    createdAt: createdAt.toISOString(),
    ...(ciRun ? {ciRun} : {}),
    packages,
  };
  await writeFile(
    join(outputDirectory, candidateManifestFile),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    join(outputDirectory, candidateOverridesFile),
    renderCandidateOverrides(manifest, publicUrl),
  );
  return manifest;
}

interface PackOneOptions {
  dependencyContext: PackageDependencyContext;
  manifestPath: string;
  outputDirectory: string;
  pack: PackPackage;
}

async function packOne({
  manifestPath,
  outputDirectory,
  pack,
  dependencyContext,
}: PackOneOptions): Promise<CandidatePackage> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  const {name, version} = manifest;
  if (typeof name !== 'string' || typeof version !== 'string') {
    throw new Error(`Publishable package has no name or version: ${manifestPath}`);
  }
  // pnpm orders the dependencies it rewrites from `workspace:` by async completion, so a rerun
  // would pack different bytes. Resolving them first, as preflight does, keeps tarballs stable.
  await writeFile(
    manifestPath,
    `${JSON.stringify(productionizeDependencyReferences(manifest, dependencyContext), null, 2)}\n`,
  );
  await pack(dirname(manifestPath), outputDirectory);
  const file = candidateTarballName(name, version);
  const content = await readFile(join(outputDirectory, file)).catch((error: unknown) => {
    throw new Error(`pnpm pack did not write ${file} for ${name}: ${String(error)}`);
  });
  return {name, version, file, integrity: sha512Integrity(content)};
}

// `pnpm <script> -- --flag` forwards the separator itself.
export function cliArguments(argv = process.argv.slice(2)): string[] {
  return argv[0] === '--' ? argv.slice(1) : argv;
}

async function main() {
  const {values} = parseArgs({
    args: cliArguments(),
    options: {
      'ci-run': {type: 'string'},
      output: {type: 'string'},
      'public-url': {type: 'string'},
      sha: {type: 'string'},
    },
  });
  const {sha, output, 'public-url': publicUrl, 'ci-run': ciRun} = values;
  if (!sha || !output || !publicUrl) {
    throw new Error('Usage: pack:candidate --sha <sha> --output <dir> --public-url <url>');
  }
  const root = getRepositoryRoot(import.meta.url);
  const controller = new AbortController();
  let restore: (() => void) | undefined;
  const stop = (signal: NodeJS.Signals) => {
    controller.abort();
    restore?.();
    process.exit(128 + constants.signals[signal]);
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const manifest = await packCandidateBundle({
      root,
      packageNames: loadPublicationClosure(root).packages,
      outputDirectory: resolve(output),
      sha,
      publicUrl,
      ciRun,
      pack: pnpmPack(controller.signal),
      onPrepared: (nextRestore) => {
        restore = nextRestore;
      },
    });
    process.stdout.write(`Packed ${manifest.packages.length} candidate packages for ${sha}.\n`);
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entryPoint === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(
      `Candidate packing failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
