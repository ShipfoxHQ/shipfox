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
 * have. Each version goes after the versions of the batch that it uses, because
 * the actions of a template or a composite action must exist when it is
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

  const ordered = orderByUse(missing);
  const token = await registry.exchangeOidcToken({oidcToken: await requestOidcToken()});
  for (const built of ordered) {
    await registry.publishVersion({token, built});
    log(`Published ${built.package}@${built.version}`);
  }
  return ordered;
}

/** Actions before templates and then by name, with every version after the batch versions it uses. */
function orderByUse(packages: readonly BuiltPackage[]): BuiltPackage[] {
  const pending = [...packages].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.package < b.package ? -1 : 1),
  );
  const unpublished = new Set(pending.map(referenceOf));
  const ordered: BuiltPackage[] = [];
  while (pending.length > 0) {
    // Exact versions cannot use each other in a cycle, so a ready version always exists.
    const index = Math.max(
      0,
      pending.findIndex((built) => built.actions.every((action) => !unpublished.has(action))),
    );
    const [next] = pending.splice(index, 1);
    if (next === undefined) break;
    unpublished.delete(referenceOf(next));
    ordered.push(next);
  }
  return ordered;
}

function referenceOf(built: BuiltPackage): string {
  return `${built.package}@${built.version}`;
}
