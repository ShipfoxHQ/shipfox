import {db} from '#db/db.js';
import {audit} from '#db/schema/audit.js';
import type {PublishTokenRefusal} from '#publish/errors.js';
import type {GrantMismatch} from '#publish/grants.js';
import type {GithubOidcClaims} from '#publish/oidc.js';

export const TOKEN_REFUSED_EVENT = 'publish-token-refused';

/**
 * Records a refused exchange of a verified OIDC token. The mismatched fields belong here and not
 * in the response, which would tell a caller how close a guess came.
 */
export async function recordTokenRefusal({
  reason,
  claims,
  namespace,
  mismatches,
}: {
  reason: PublishTokenRefusal;
  claims: GithubOidcClaims;
  namespace?: string | undefined;
  mismatches?: GrantMismatch[] | undefined;
}): Promise<void> {
  await db()
    .insert(audit)
    .values({
      event: TOKEN_REFUSED_EVENT,
      outcome: 'refused',
      reason,
      namespace: namespace ?? null,
      detail: {...(mismatches === undefined ? {} : {grants: mismatches}), oidc: claims},
    });
}
