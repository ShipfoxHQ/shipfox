import {compareRegistryVersions, type RegistryBump} from '@shipfox/registry-format';
import type {BuiltPackage} from './build.js';
import {bumpRank, computeMinimumBump, versionBump} from './bump.js';
import type {PendingChangeset} from './changesets.js';
import {pendingBumps} from './changesets.js';
import type {RegistryReader} from './registry-client.js';
import {publishRuleIssues} from './rules.js';

export type CheckMode = 'pr' | 'release';

export interface CheckFinding {
  level: 'error' | 'warning';
  package: string;
  message: string;
}

export interface CheckResult {
  findings: CheckFinding[];
  ok: boolean;
}

/**
 * `pr`: a package whose content differs from its published version needs a
 * pending changeset with a large enough bump. `release`: a published version
 * never changes, and a new version meets the bump rules against the highest
 * lower published version. An unpublished package passes both modes.
 */
export async function runCheck({
  mode,
  packages,
  registry,
  changesets,
}: {
  mode: CheckMode;
  packages: readonly BuiltPackage[];
  registry: RegistryReader;
  changesets: readonly PendingChangeset[];
}): Promise<CheckResult> {
  const bumps = pendingBumps(changesets);
  const configured = new Set(packages.map(({package: name}) => name));
  const findings: CheckFinding[] = [];

  for (const built of packages) {
    const report = (level: CheckFinding['level'], message: string) =>
      findings.push({level, package: built.package, message});

    for (const issue of publishRuleIssues(built)) report('error', issue);
    await warnAboutRelated({built, configured, registry, report});
    if (mode === 'pr') await checkPendingChangeset({built, registry, bumps, report});
    else await checkRelease({built, packages, registry, report});
  }
  return {findings, ok: findings.every(({level}) => level !== 'error')};
}

type Report = (level: CheckFinding['level'], message: string) => void;

async function checkPendingChangeset({
  built,
  registry,
  bumps,
  report,
}: {
  built: BuiltPackage;
  registry: RegistryReader;
  bumps: ReadonlyMap<string, RegistryBump>;
  report: Report;
}) {
  const published = await registry.getVersionDocument(built);
  if (published === undefined || published.fingerprint === built.fingerprint) return;

  const minimum = computeMinimumBump({
    kind: built.kind,
    previous: published.manifest,
    next: built.manifest,
  });
  const pending = bumps.get(built.workspaceName);
  if (pending !== undefined && bumpRank(pending) >= bumpRank(minimum)) return;
  report(
    'error',
    `${built.version} changed after it was published. Add a changeset that bumps ${built.workspaceName} by at least ${minimum} (${pending === undefined ? 'no pending changeset' : `pending: ${pending}`}).`,
  );
}

async function checkRelease({
  built,
  registry,
  packages,
  report,
}: {
  built: BuiltPackage;
  packages: readonly BuiltPackage[];
  registry: RegistryReader;
  report: Report;
}) {
  const published = await registry.getVersionDocument(built);
  if (published !== undefined) {
    if (published.fingerprint !== built.fingerprint) {
      report('error', `${built.version} is published and this build differs. Bump the version.`);
    }
    return;
  }

  await checkActionsExist({built, packages, registry, report});
  const previous = await highestLowerVersion({built, registry});
  if (previous === undefined) return;
  const previousDocument = await registry.getVersionDocument({
    package: built.package,
    version: previous,
  });
  if (previousDocument === undefined) return;

  const minimum = computeMinimumBump({
    kind: built.kind,
    previous: previousDocument.manifest,
    next: built.manifest,
  });
  const actual = versionBump({previous, next: built.version});
  if (bumpRank(actual) < bumpRank(minimum)) {
    report(
      'error',
      `${previous} to ${built.version} is a ${actual} bump, and the changes need at least ${minimum}.`,
    );
  }
}

// Every action a template uses must exist in the registry or be published in the same batch.
async function checkActionsExist({
  built,
  packages,
  registry,
  report,
}: {
  built: BuiltPackage;
  packages: readonly BuiltPackage[];
  registry: RegistryReader;
  report: Report;
}) {
  const batch = new Set(packages.map((entry) => `${entry.package}@${entry.version}`));
  for (const reference of built.actions) {
    if (batch.has(reference)) continue;
    const separator = reference.lastIndexOf('@');
    const published = await registry.getVersionDocument({
      package: reference.slice(0, separator),
      version: reference.slice(separator + 1),
    });
    if (published === undefined) {
      report('error', `Uses ${reference}, which is neither published nor part of this release.`);
    }
  }
}

async function highestLowerVersion({
  built,
  registry,
}: {
  built: BuiltPackage;
  registry: RegistryReader;
}): Promise<string | undefined> {
  const index = await registry.getPackageIndex(built);
  return index?.versions
    .map(({version}) => version)
    .filter((version) => compareRegistryVersions(version, built.version) < 0)
    .sort(compareRegistryVersions)
    .at(-1);
}

async function warnAboutRelated({
  built,
  configured,
  registry,
  report,
}: {
  built: BuiltPackage;
  configured: ReadonlySet<string>;
  registry: RegistryReader;
  report: Report;
}) {
  const related = Array.isArray(built.manifest.related) ? built.manifest.related : [];
  for (const name of related) {
    if (typeof name !== 'string' || configured.has(name)) continue;
    if ((await registry.getPackageIndex({package: name})) === undefined) {
      report('warning', `related names ${name}, which is neither published nor configured.`);
    }
  }
}
