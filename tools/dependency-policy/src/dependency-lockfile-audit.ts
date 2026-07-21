import {readFile} from 'node:fs/promises';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {parse as parseYaml} from 'yaml';

interface PackageResolution {
  package: string;
  versions: string[];
}

interface AuditResult {
  curatedSingletons: PackageResolution[];
  duplicates: PackageResolution[];
  errors: string[];
}

function assertion(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function parseSnapshotKey(snapshotKey: string): {packageName: string; version: string} {
  assertion(typeof snapshotKey === 'string' && snapshotKey.length > 0, 'Invalid snapshot key');
  const scopeSeparator = snapshotKey.indexOf('/');
  const versionSeparator = snapshotKey.startsWith('@')
    ? snapshotKey.indexOf('@', scopeSeparator + 1)
    : snapshotKey.indexOf('@');
  assertion(versionSeparator > 0, `Invalid pnpm snapshot key: ${snapshotKey}`);
  const packageName = snapshotKey.slice(0, versionSeparator);
  const resolutionIdentity = snapshotKey.slice(versionSeparator + 1);
  const peerContextStart = resolutionIdentity.indexOf('(');
  const version =
    peerContextStart === -1 ? resolutionIdentity : resolutionIdentity.slice(0, peerContextStart);
  assertion(version.length > 0, `Invalid pnpm snapshot key: ${snapshotKey}`);
  return {packageName, version};
}

export function resolveLockfileVersions(lockfileText: string): PackageResolution[] {
  const lockfile: unknown = parseYaml(lockfileText);
  assertion(isRecord(lockfile), 'pnpm lockfile must be a YAML object');
  assertion(isRecord(lockfile.snapshots), 'pnpm lockfile must contain snapshots');
  const versionsByPackage = new Map<string, Set<string>>();
  for (const snapshotKey of Object.keys(lockfile.snapshots)) {
    const {packageName, version} = parseSnapshotKey(snapshotKey);
    const versions = versionsByPackage.get(packageName) ?? new Set();
    versions.add(version);
    versionsByPackage.set(packageName, versions);
  }
  return [...versionsByPackage]
    .map(([packageName, versions]) => ({
      package: packageName,
      versions: [...versions].sort(compareText),
    }))
    .sort((left, right) => compareText(left.package, right.package));
}

function catalogName(reference: unknown): string | null {
  if (reference === 'catalog:') return 'default';
  if (typeof reference === 'string' && reference.startsWith('catalog:')) {
    return reference.slice('catalog:'.length) || null;
  }
  return null;
}

function catalogFor(workspace: Record<string, unknown>, name: string): unknown {
  if (name === 'default') return workspace.catalog;
  return isRecord(workspace.catalogs) ? workspace.catalogs[name] : undefined;
}

export function auditDependencyGraph({
  lockfileText,
  workspaceText,
}: {
  lockfileText: string;
  workspaceText: string;
}): AuditResult {
  const resolutions = resolveLockfileVersions(lockfileText);
  const duplicates = resolutions.filter(({versions}) => versions.length > 1);
  const observedByPackage = new Map(
    resolutions.map(({package: packageName, versions}) => [packageName, versions]),
  );
  const workspace: unknown = parseYaml(workspaceText);
  assertion(isRecord(workspace), 'pnpm workspace file must be a YAML object');
  const overrides = workspace.overrides ?? {};
  assertion(isRecord(overrides), 'pnpm overrides must be a YAML object');
  const errors: string[] = [];
  const curatedSingletons: Array<{package: string; versions: string[]}> = [];

  for (const [packageName, reference] of Object.entries(overrides).sort(([left], [right]) =>
    compareText(left, right),
  )) {
    const name = catalogName(reference);
    if (!name) {
      errors.push(`Curated singleton ${packageName} override must reference a catalog`);
    } else {
      const catalog = catalogFor(workspace, name);
      if (!isRecord(catalog) || typeof catalog[packageName] !== 'string') {
        errors.push(`Curated singleton ${packageName} is missing from the ${name} catalog`);
      }
    }

    const versions = observedByPackage.get(packageName) ?? [];
    curatedSingletons.push({package: packageName, versions});
    if (versions.length !== 1) {
      errors.push(
        `Curated singleton ${packageName} must resolve once; observed ${versions.join(', ') || 'no versions'}`,
      );
    }
  }

  return {curatedSingletons, duplicates, errors};
}

function packageCount(count: number): string {
  return `${count} package${count === 1 ? '' : 's'}`;
}

export function formatAuditResult(
  result: AuditResult,
  {verbose = false}: {verbose?: boolean} = {},
): string {
  const lines = [
    `Transitive duplicates: ${packageCount(result.duplicates.length)}${
      verbose ? '' : ' (use --verbose for the complete report)'
    }`,
  ];
  if (verbose) {
    for (const duplicate of result.duplicates) {
      lines.push(`${duplicate.package}: ${duplicate.versions.join(', ')}`);
    }
  }
  lines.push('', `Curated singletons: ${packageCount(result.curatedSingletons.length)}`);
  for (const singleton of result.curatedSingletons) {
    lines.push(`${singleton.package}: ${singleton.versions.join(', ') || 'not resolved'}`);
  }
  if (result.errors.length > 0) {
    lines.push('', `Lockfile audit failed (${result.errors.length} errors)`);
    for (const error of result.errors) lines.push(`- ${error}`);
  } else {
    lines.push('', 'Lockfile audit passed');
  }
  return `${lines.join('\n')}\n`;
}

export async function auditRepository(): Promise<AuditResult> {
  const [lockfileText, workspaceText] = await Promise.all([
    readFile(new URL('../../../pnpm-lock.yaml', import.meta.url), 'utf8'),
    readFile(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8'),
  ]);
  return auditDependencyGraph({lockfileText, workspaceText});
}

async function main(): Promise<void> {
  const result = await auditRepository();
  process.stdout.write(formatAuditResult(result, {verbose: process.argv.includes('--verbose')}));
  if (result.errors.length > 0) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Lockfile audit failed: ${message}\n`);
    process.exitCode = 1;
  });
}
