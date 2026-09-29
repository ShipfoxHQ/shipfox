import {
  PACKAGE_UPDATE_CHANGELOG_ENTRY_MAX_LENGTH,
  PACKAGE_UPDATE_CHANGELOG_MAX_ENTRIES,
  type PackageUpdateDto,
} from '@shipfox/api-definitions-dto';
import {
  type RegistryInterModuleClient,
  registryInterModuleContract,
} from '@shipfox/api-registry-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {boundedMap} from '@shipfox/node-module';
import {
  compareRegistryVersions,
  type RegistryBump,
  type RegistryPackageIndex,
} from '@shipfox/registry-format';
import {buildUpgradePrompt} from '@shipfox/workflow-templates/prompt';
import type {RegistryActionRef, RegistryRef, RegistryTemplateRef} from './entities/registry-ref.js';

const PACKAGE_INDEX_CONCURRENCY = 5;
const BUMP_RANK: Record<RegistryBump, number> = {patch: 0, minor: 1, major: 2};

export interface PackageUpdatesParams {
  registryRefs: readonly RegistryRef[];
  /** The definition's repository path, which the upgrade prompt names. */
  configPath: string | null;
  registry: Pick<RegistryInterModuleClient, 'getPackageIndex' | 'resolveVersion'>;
}

type PinnedRef = RegistryActionRef | RegistryTemplateRef;

/**
 * What the registry has newer than each version the definition pins. A reference whose package the
 * registry cannot describe right now is left out, because the notice is informational.
 */
export async function getPackageUpdates(params: PackageUpdatesParams): Promise<PackageUpdateDto[]> {
  const pinned = params.registryRefs.filter((ref): ref is PinnedRef => !('legacy' in ref));
  const updates = await boundedMap(pinned, PACKAGE_INDEX_CONCURRENCY, (ref) =>
    packageUpdate({...params, ref}),
  );
  return updates.filter((update) => update !== undefined);
}

async function packageUpdate(
  params: PackageUpdatesParams & {ref: PinnedRef},
): Promise<PackageUpdateDto | undefined> {
  const {ref, registry} = params;
  const index = await readPackageIndex(registry, ref.package);
  if (index === undefined || index.kind !== ref.kind) return undefined;

  const latest = index.versions
    .map((entry) => entry.version)
    .reduce<string | undefined>(
      (highest, version) =>
        highest === undefined || compareRegistryVersions(version, highest) > 0 ? version : highest,
      undefined,
    );
  if (latest === undefined) return undefined;

  const newer = index.versions
    .filter((entry) => compareRegistryVersions(entry.version, ref.version) > 0)
    .sort((a, b) => compareRegistryVersions(b.version, a.version));
  const behind = newer.length > 0;
  const update: PackageUpdateDto = {
    kind: ref.kind,
    package: ref.package,
    version: ref.version,
    latest,
    behind,
    bump: highestBump(newer.map((entry) => entry.bump)),
    changelog: await changelogEntries({
      registry,
      kind: ref.kind,
      package: ref.package,
      versions: newer.slice(0, PACKAGE_UPDATE_CHANGELOG_MAX_ENTRIES).map((entry) => entry.version),
    }),
  };

  if (ref.kind === 'action') {
    return {
      ...update,
      capability_change: newer.some((entry) => entry.capability_change),
      steps: ref.steps,
    };
  }
  if (!behind) return update;
  return {
    ...update,
    upgrade_prompt: buildUpgradePrompt({
      package: ref.package,
      configPath: params.configPath,
      version: latest,
    }),
  };
}

async function readPackageIndex(
  registry: PackageUpdatesParams['registry'],
  packageName: string,
): Promise<RegistryPackageIndex | undefined> {
  try {
    const {index} = await registry.getPackageIndex({package: packageName});
    return index ?? undefined;
  } catch (error) {
    if (isInterModuleKnownError(registryInterModuleContract.methods.getPackageIndex, error)) {
      return undefined;
    }
    throw error;
  }
}

/** The highest bump, or `null` when no newer version carries one. */
function highestBump(bumps: readonly (RegistryBump | undefined)[]): RegistryBump | null {
  let highest: RegistryBump | null = null;
  for (const bump of bumps) {
    if (bump === undefined) continue;
    if (highest === null || BUMP_RANK[bump] > BUMP_RANK[highest]) highest = bump;
  }
  return highest;
}

/** The changelog sections of the given versions, newest first, without the versions that have none. */
async function changelogEntries(params: {
  registry: PackageUpdatesParams['registry'];
  kind: 'action' | 'template';
  package: string;
  versions: readonly string[];
}): Promise<PackageUpdateDto['changelog']> {
  const {registry, kind, versions} = params;
  const entries = await Promise.all(
    versions.map(async (version) => {
      try {
        const resolved = await registry.resolveVersion({package: params.package, version, kind});
        const markdown = resolved.document.changelog?.trim();
        return markdown ? {version, markdown: truncate(markdown)} : undefined;
      } catch (error) {
        // A version that cannot be verified or fetched has no changelog to show.
        if (isInterModuleKnownError(registryInterModuleContract.methods.resolveVersion, error)) {
          return undefined;
        }
        throw error;
      }
    }),
  );
  return entries.filter((entry) => entry !== undefined);
}

function truncate(markdown: string): string {
  if (markdown.length <= PACKAGE_UPDATE_CHANGELOG_ENTRY_MAX_LENGTH) return markdown;
  return `${markdown.slice(0, PACKAGE_UPDATE_CHANGELOG_ENTRY_MAX_LENGTH - 1)}…`;
}
