import {logger} from '@shipfox/node-opentelemetry';
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

export const VERSION_PUBLISHED_EVENT = 'version-published';
export const VERSION_REFUSED_EVENT = 'version-publish-refused';
export const VERSION_RETRIED_EVENT = 'version-publish-retried';

/**
 * Records a publish attempt that the transaction did not record itself: a refusal, or a retry of a
 * version that was already committed. A failure to write is logged and never hides the outcome.
 */
export async function recordVersionAttempt({
  event,
  outcome,
  reason,
  namespace,
  packageName,
  version,
  detail,
}: {
  event: typeof VERSION_REFUSED_EVENT | typeof VERSION_RETRIED_EVENT;
  outcome: 'accepted' | 'refused';
  reason?: string | undefined;
  namespace: string;
  packageName: string;
  version: string;
  detail: Record<string, unknown>;
}): Promise<void> {
  try {
    await db()
      .insert(audit)
      .values({
        event,
        outcome,
        reason: reason ?? null,
        namespace,
        package: packageName,
        version,
        detail,
      });
  } catch (error) {
    logger().error({err: error, event, packageName, version}, 'Failed to record a publish attempt');
  }
}
