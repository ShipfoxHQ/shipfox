import {randomUUID} from 'node:crypto';
import type {RegistryVersionDocument} from '@shipfox/registry-format';
import {SignJWT} from 'jose';
import type {RegistryBootstrapNamespace} from '#bootstrap.js';
import type {GithubOidcClaims} from '#publish/oidc.js';
import type {RegistrySigningKey} from '#signing-key.js';

export const PUBLISH_TOKEN_AUDIENCE = 'registry-publish';
export const PUBLISH_TOKEN_LIFETIME_SECONDS = 10 * 60;

/** What a publish token carries besides the standard claims. The upload adds `path` itself. */
export interface PublishTokenClaims {
  namespace: string;
  grant: {
    provider: 'github';
    repository_id: string;
    repository_owner_id: string;
    workflow: string;
  };
  provenance: Omit<RegistryVersionDocument['provenance'], 'path'>;
}

/** Signs the short-lived token that lets one CI run publish into one namespace. */
export async function mintPublishToken({
  signingKey,
  publicUrl,
  namespace,
  publisher,
  claims,
}: {
  signingKey: RegistrySigningKey;
  publicUrl: string;
  namespace: string;
  publisher: RegistryBootstrapNamespace['publishers'][number];
  claims: GithubOidcClaims;
}): Promise<{token: string; expiresAt: Date}> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + PUBLISH_TOKEN_LIFETIME_SECONDS;
  const publishClaims: PublishTokenClaims = {
    namespace,
    grant: {
      provider: publisher.provider,
      repository_id: publisher.repository_id,
      repository_owner_id: publisher.repository_owner_id,
      workflow: publisher.workflow,
    },
    provenance: {
      issuer: claims.iss,
      repository: claims.repository,
      repository_id: claims.repository_id,
      repository_owner_id: claims.repository_owner_id,
      commit: claims.sha,
      ref: claims.ref,
      workflow_ref: claims.workflow_ref,
      run_id: claims.run_id,
      run_attempt: claims.run_attempt,
    },
  };

  const token = await new SignJWT({...publishClaims})
    .setProtectedHeader({alg: 'EdDSA', kid: signingKey.keyid})
    .setIssuer(publicUrl)
    .setAudience(PUBLISH_TOKEN_AUDIENCE)
    .setJti(randomUUID())
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(signingKey.privateKey);
  return {token, expiresAt: new Date(expiresAt * 1000)};
}
