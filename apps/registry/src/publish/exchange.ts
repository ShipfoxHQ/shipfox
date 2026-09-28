import {registryJtiPath} from '@shipfox/registry-format';
import type {RegistryBootstrap} from '#bootstrap.js';
import {JSON_CONTENT_TYPE, jsonBody} from '#indexes.js';
import {recordTokenRefusal} from '#publish/audit.js';
import {PublishTokenRefusedError} from '#publish/errors.js';
import {matchPublishGrant} from '#publish/grants.js';
import type {OidcVerifier} from '#publish/oidc.js';
import {mintPublishToken} from '#publish/publish-token.js';
import type {RegistrySigningKey} from '#signing-key.js';
import {type RegistryStorage, StoragePreconditionFailedError} from '#storage/storage.js';

export type PublishTokenExchange = (params: {
  oidcToken: string;
}) => Promise<{publishToken: string; expiresAt: Date}>;

/**
 * Exchanges a CI provider's OIDC token for a publish token. The token must verify, match an active
 * publish grant, and not have been used before. Matching comes before the single-use record, so
 * an OIDC token from any repository cannot fill the bucket with token ids.
 */
export function createPublishTokenExchange({
  storage,
  bootstrap,
  signingKey,
  publicUrl,
  verifyOidcToken,
}: {
  storage: RegistryStorage;
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
        storage,
        reason,
        claims,
        namespace: match.outcome === 'suspended' ? match.namespace : undefined,
        mismatches: match.outcome === 'unmatched' ? match.mismatches : undefined,
      });
      throw new PublishTokenRefusedError({reason});
    }

    if (!(await consumeTokenId({storage, jti: claims.jti}))) {
      await recordTokenRefusal({
        storage,
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

/** A create-only write, so a token id is consumed once across every replica sharing the store. */
async function consumeTokenId({
  storage,
  jti,
}: {
  storage: RegistryStorage;
  jti: string;
}): Promise<boolean> {
  try {
    await storage.put({
      key: registryJtiPath(jti),
      body: jsonBody({consumed_at: new Date().toISOString()}),
      contentType: JSON_CONTENT_TYPE,
      ifNoneMatch: '*',
    });
    return true;
  } catch (error) {
    if (error instanceof StoragePreconditionFailedError) return false;
    throw error;
  }
}
