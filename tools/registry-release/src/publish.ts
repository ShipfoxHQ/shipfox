import type {RegistryPackageKind} from '@shipfox/registry-format';
import type {BuiltPackage} from './build.js';
import {runCheck} from './check.js';
import type {RegistryClient} from './registry-client.js';

const KIND_ORDER: Record<RegistryPackageKind, number> = {action: 0, template: 1};

export class ReleaseCheckFailedError extends Error {
  constructor(readonly messages: string[]) {
    super(`The release check failed:\n${messages.map((message) => `- ${message}`).join('\n')}`);
    this.name = 'ReleaseCheckFailedError';
  }
}

/**
 * Runs `check --mode release`, then uploads the versions the registry does not
 * have: actions first, because a template's actions must exist when it is
 * published. Versions the registry already has are skipped, so a retry of a
 * partial publish continues where it stopped.
 */
export async function publishPackages({
  packages,
  registry,
  requestOidcToken,
  log,
}: {
  packages: readonly BuiltPackage[];
  registry: RegistryClient;
  requestOidcToken: () => Promise<string>;
  log: (line: string) => void;
}): Promise<BuiltPackage[]> {
  const result = await runCheck({mode: 'release', packages, registry, changesets: []});
  if (!result.ok) {
    throw new ReleaseCheckFailedError(
      result.findings
        .filter(({level}) => level === 'error')
        .map(({package: name, message}) => `${name}: ${message}`),
    );
  }

  const missing: BuiltPackage[] = [];
  for (const built of packages) {
    if ((await registry.getVersionDocument(built)) === undefined) missing.push(built);
  }
  if (missing.length === 0) {
    log('Every version is already published.');
    return [];
  }

  const ordered = missing.sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.package < b.package ? -1 : 1),
  );
  const token = await registry.exchangeOidcToken({oidcToken: await requestOidcToken()});
  for (const built of ordered) {
    await registry.publishVersion({token, built});
    log(`Published ${built.package}@${built.version}`);
  }
  return ordered;
}
