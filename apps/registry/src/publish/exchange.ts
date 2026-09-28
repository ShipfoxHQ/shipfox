import type {RegistryBootstrap} from '#bootstrap.js';
import {recordTokenRefusal} from '#publish/audit.js';
import {PublishTokenRefusedError} from '#publish/errors.js';
import {matchPublishGrant} from '#publish/grants.js';
import {CLOCK_SKEW_SECONDS, type OidcVerifier} from '#publish/oidc.js';
import {mintPublishToken} from '#publish/publish-token.js';
import {consumeTokenId} from '#publish/used-tokens.js';
import type {RegistrySigningKey} from '#signing-key.js';

export type PublishTokenExchange = (params: {
  oidcToken: string;
}) => Promise<{publishToken: string; expiresAt: Date}>;

/**
 * Exchanges a CI provider's OIDC token for a publish token. The token must verify, match an active
 * publish grant, and not have been used before. Matching comes before the single-use record, so
 * an OIDC token from any repository cannot fill the database with token ids.
 */
export function createPublishTokenExchange({
  bootstrap,
  signingKey,
  publicUrl,
  verifyOidcToken,
}: {
  bootstrap: RegistryBootstrap;
  signingKey: RegistrySigningKey;
  publicUrl: string;
  verifyOidcToken: OidcVerifier;
}): PublishTokenExchange {
  return async ({oidcToken}) => {
    const claims = await verifyOidcToken(oidcToken);

    const match = matchPublishGrant({bootstrap, claims});
    if (match.outcome !== 'matched') {
      const reason =
        match.outcome === 'suspended' ? 'namespace-suspended' : 'publish-grant-not-found';
      await recordTokenRefusal({
        reason,
        claims,
        namespace: match.outcome === 'suspended' ? match.namespace : undefined,
        mismatches: match.outcome === 'unmatched' ? match.mismatches : undefined,
      });
      throw new PublishTokenRefusedError({reason});
    }

    if (!(await consumeTokenId({jti: claims.jti, expiresAt: tokenExpiry(claims.exp)}))) {
      await recordTokenRefusal({
        reason: 'oidc-token-replayed',
        claims,
        namespace: match.namespace,
      });
      throw new PublishTokenRefusedError({reason: 'oidc-token-replayed'});
    }

    const {token, expiresAt} = await mintPublishToken({
      signingKey,
      publicUrl,
      namespace: match.namespace,
      publisher: match.publisher,
      claims,
    });
    return {publishToken: token, expiresAt};
  };
}

// The verifier accepts a token until `exp` plus its clock tolerance, so the record lives that long.
function tokenExpiry(exp: number): Date {
  return new Date((exp + CLOCK_SKEW_SECONDS) * 1000);
}
