import type {RegistryBootstrap, RegistryBootstrapNamespace} from '#bootstrap.js';
import type {GithubOidcClaims} from '#publish/oidc.js';

type Publisher = RegistryBootstrapNamespace['publishers'][number];

export interface GrantMismatch {
  namespace: string;
  fields: string[];
}

export type GrantMatch =
  | {outcome: 'matched'; namespace: string; publisher: Publisher}
  | {outcome: 'suspended'; namespace: string}
  | {outcome: 'unmatched'; mismatches: GrantMismatch[]};

/** Returns the first active grant, in bootstrap order, that every claim satisfies. */
export function matchPublishGrant({
  bootstrap,
  claims,
}: {
  bootstrap: RegistryBootstrap;
  claims: GithubOidcClaims;
}): GrantMatch {
  const mismatches: GrantMismatch[] = [];
  let suspendedNamespace: string | undefined;
  for (const [namespace, {status, publishers}] of Object.entries(bootstrap.namespaces)) {
    for (const publisher of publishers) {
      const fields = mismatchedFields({claims, publisher});
      if (fields.length > 0) mismatches.push({namespace, fields});
      else if (status === 'active') return {outcome: 'matched', namespace, publisher};
      else suspendedNamespace ??= namespace;
    }
  }
  return suspendedNamespace === undefined
    ? {outcome: 'unmatched', mismatches}
    : {outcome: 'suspended', namespace: suspendedNamespace};
}

function mismatchedFields({
  claims,
  publisher,
}: {
  claims: GithubOidcClaims;
  publisher: Publisher;
}): string[] {
  const fields: string[] = [];
  if (claims.repository_id !== publisher.repository_id) fields.push('repository_id');
  if (claims.repository_owner_id !== publisher.repository_owner_id) {
    fields.push('repository_owner_id');
  }
  // The repository claim, not the grant's display name, so a rename does not break publishing:
  // the numeric ids above already pin which repository this is.
  if (!claims.workflow_ref.startsWith(`${claims.repository}/${publisher.workflow}@`)) {
    fields.push('workflow_ref');
  }
  if (publisher.ref && !publisher.ref.some((pattern) => refMatches({pattern, ref: claims.ref}))) {
    fields.push('ref');
  }
  if (publisher.environment !== undefined && claims.environment !== publisher.environment) {
    fields.push('environment');
  }
  if (claims.runner_environment !== publisher.runner_environment) {
    fields.push('runner_environment');
  }
  return fields;
}

/** `*` matches any run of characters inside one path segment. */
function refMatches({pattern, ref}: {pattern: string; ref: string}): boolean {
  const source = pattern
    .split('*')
    .map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${source}$`).test(ref);
}
