import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {mapWithConcurrency} from './productionized-manifest-packer.js';
import {fetchRegistryPackageDocument} from './publication-preflight.js';
import type {PublishedPackageVersion} from './publish-productionized-closure.js';

// Resolves to undefined when the version is installable, otherwise to the reason it is not.
export type VersionAvailabilityCheck = (
  entry: PublishedPackageVersion,
) => Promise<string | undefined>;

interface WaitForPublishedVersionsOptions {
  check?: VersionAvailabilityCheck;
  intervalMs?: number;
  now?: () => number;
  packages: PublishedPackageVersion[];
  sleep?: (ms: number) => Promise<unknown>;
  timeoutMs?: number;
}

const defaultTimeoutMs = 15 * 60 * 1000;
const defaultIntervalMs = 15 * 1000;

export async function checkRegistryAvailability({
  name,
  version,
}: PublishedPackageVersion): Promise<string | undefined> {
  const metadata = (await fetchRegistryPackageDocument(name))?.versions?.[version];
  if (!metadata) return 'version missing from registry metadata';
  const tarball = metadata.dist?.tarball;
  if (typeof tarball !== 'string') return 'registry metadata has no tarball URL';
  const response = await fetch(tarball, {method: 'HEAD'});
  return response.ok ? undefined : `tarball returned status ${response.status}`;
}

export async function waitForPublishedVersions({
  packages,
  check = checkRegistryAvailability,
  timeoutMs = defaultTimeoutMs,
  intervalMs = defaultIntervalMs,
  now = Date.now,
  sleep = delay,
}: WaitForPublishedVersionsOptions): Promise<void> {
  const deadline = now() + timeoutMs;
  let pending = packages.map((entry) => ({entry, reason: 'not checked'}));

  while (pending.length > 0) {
    const results = await mapWithConcurrency(pending, 5, async ({entry}) => {
      try {
        return {entry, reason: await check(entry)};
      } catch (error) {
        return {entry, reason: error instanceof Error ? error.message : String(error)};
      }
    });
    pending = results.flatMap(({entry, reason}) => (reason === undefined ? [] : [{entry, reason}]));
    if (pending.length === 0) break;
    if (now() >= deadline) {
      throw new Error(
        `Published versions are still unavailable on npm after ${Math.round(timeoutMs / 1000)}s: ` +
          pending.map(({entry, reason}) => `${entry.name}@${entry.version} (${reason})`).join(', '),
      );
    }
    process.stdout.write(
      `Waiting for ${pending.length} of ${packages.length} published versions on npm.\n`,
    );
    await sleep(intervalMs);
  }
  process.stdout.write(`All ${packages.length} published versions are installable from npm.\n`);
}

export async function readPublishedVersions(path: string): Promise<PublishedPackageVersion[]> {
  const document = JSON.parse(await readFile(path, 'utf8')) as {packages?: unknown};
  if (!Array.isArray(document.packages) || !document.packages.every(isPublishedPackageVersion)) {
    throw new Error(`Invalid published versions file at ${path}`);
  }
  return document.packages;
}

function isPublishedPackageVersion(value: unknown): value is PublishedPackageVersion {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === 'string' && typeof record.version === 'string';
}

async function main() {
  const path = process.env.SHIPFOX_PUBLISHED_VERSIONS_PATH;
  if (!path) throw new Error('SHIPFOX_PUBLISHED_VERSIONS_PATH is required');
  await waitForPublishedVersions({packages: await readPublishedVersions(path)});
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entryPoint === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(
      `Publication readiness failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
