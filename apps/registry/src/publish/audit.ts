import {randomUUID} from 'node:crypto';
import {REGISTRY_PRIVATE_PREFIX} from '@shipfox/registry-format';
import {JSON_CONTENT_TYPE, jsonBody} from '#indexes.js';
import type {PublishTokenRefusal} from '#publish/errors.js';
import type {GrantMismatch} from '#publish/grants.js';
import type {GithubOidcClaims} from '#publish/oidc.js';
import type {RegistryStorage} from '#storage/storage.js';

/**
 * Records a refused exchange of a verified OIDC token. The mismatched fields belong here and not
 * in the response, which would tell a caller how close a guess came. The key follows the audit
 * layout, with `token` in place of the package and version that an exchange does not know yet.
 */
export async function recordTokenRefusal({
  storage,
  reason,
  claims,
  namespace,
  mismatches,
}: {
  storage: RegistryStorage;
  reason: PublishTokenRefusal;
  claims: GithubOidcClaims;
  namespace?: string | undefined;
  mismatches?: GrantMismatch[] | undefined;
}): Promise<void> {
  const at = new Date();
  const timestamp = at.toISOString().replaceAll(':', '');
  await storage.put({
    key: `${REGISTRY_PRIVATE_PREFIX}audit/${timestamp.slice(0, 'yyyy-mm-dd'.length)}/${timestamp}-token-${randomUUID()}.json`,
    body: jsonBody({
      event: 'publish-token-refused',
      at: at.toISOString(),
      reason,
      ...(namespace === undefined ? {} : {namespace}),
      ...(mismatches === undefined ? {} : {grants: mismatches}),
      oidc: claims,
    }),
    contentType: JSON_CONTENT_TYPE,
    ifNoneMatch: '*',
  });
}
