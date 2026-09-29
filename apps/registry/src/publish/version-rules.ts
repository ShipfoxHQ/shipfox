import {
  compareRegistryVersions,
  isRegistrySlug,
  isRegistryVersion,
  parseRegistryVersion,
  type RegistryBump,
} from '@shipfox/registry-format';
import {VersionRefusedError} from '#publish/errors.js';

const BUMP_RANK: Record<RegistryBump, number> = {patch: 0, minor: 1, major: 2};

/** A namespace, name, and version that are safe to use in keys and paths. */
export function checkPackageCoordinates({
  namespace,
  name,
  version,
}: {
  namespace: string;
  name: string;
  version: string;
}): void {
  if (!(isRegistrySlug(namespace) && isRegistrySlug(name))) {
    throw new VersionRefusedError(
      'invalid-package-name',
      'Namespaces and names use 2 to 40 lowercase letters, digits, and single hyphens',
    );
  }
  if (!isRegistryVersion(version)) {
    throw new VersionRefusedError(
      'invalid-package-name',
      'A version is MAJOR.MINOR.PATCH, without leading zeros or a pre-release',
    );
  }
}

/** A reserved entry is a slug or a prefix ending in `*`, as the bootstrap file declares them. */
export function isReservedName({
  name,
  reserved,
}: {
  name: string;
  reserved: readonly string[];
}): boolean {
  return reserved.some((entry) =>
    entry.endsWith('*') ? name.startsWith(entry.slice(0, -1)) : name === entry,
  );
}

/** The largest version below `version`, or undefined when there is none. */
export function highestLowerVersion({
  version,
  versions,
}: {
  version: string;
  versions: readonly string[];
}): string | undefined {
  return versions
    .filter((candidate) => compareRegistryVersions(candidate, version) < 0)
    .sort(compareRegistryVersions)
    .at(-1);
}

/** What the step from `previous` to `next` promises: the highest component that grew. */
export function versionStep({previous, next}: {previous: string; next: string}): RegistryBump {
  const before = parseRegistryVersion(previous);
  const after = parseRegistryVersion(next);
  if (!(before && after)) throw new TypeError('Expected exact versions');
  if (after.major > before.major) return 'major';
  return after.minor > before.minor ? 'minor' : 'patch';
}

/** Refuses a version whose step is smaller than the changes need. */
export function checkBump({
  previous,
  next,
  required,
}: {
  previous: string;
  next: string;
  required: RegistryBump;
}): void {
  const step = versionStep({previous, next});
  if (BUMP_RANK[step] < BUMP_RANK[required]) {
    throw new VersionRefusedError(
      'bump-too-low',
      `${next} is a ${step} bump from ${previous}, but the changes need a ${required} bump`,
    );
  }
}
