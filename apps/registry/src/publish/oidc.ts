import {registryJtiPath} from '@shipfox/registry-format';
import {createRemoteJWKSet, errors, jwtVerify} from 'jose';
import {z} from 'zod';
import {PublishTokenRefusedError} from '#publish/errors.js';
import {describeIssues} from '#publish/issues.js';

export const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
export const CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_AGE_SECONDS = 10 * 60;
// Failing to fetch or read the issuer's key set is an outage to report, not a bad token.
const ISSUER_FAILURE_CODES = new Set(['ERR_JWKS_TIMEOUT', 'ERR_JWKS_INVALID', 'ERR_JOSE_GENERIC']);

const githubOidcClaimsSchema = z.object({
  iss: z.string().min(1),
  jti: z.string().refine(isTokenId, 'is not a valid token id'),
  exp: z.number().int(),
  repository: z.string().min(1),
  repository_id: z.string().min(1),
  repository_owner_id: z.string().min(1),
  workflow_ref: z.string().min(1),
  ref: z.string().min(1),
  sha: z.string().min(1),
  run_id: z.string().min(1),
  run_attempt: z.string().min(1),
  environment: z.string().min(1).optional(),
  runner_environment: z.string().min(1),
});

export type GithubOidcClaims = z.infer<typeof githubOidcClaimsSchema>;

/** Resolves to the claims of a token that passed every check, or throws `PublishTokenRefusedError`. */
export type OidcVerifier = (token: string) => Promise<GithubOidcClaims>;

/**
 * Verifies GitHub Actions OIDC tokens. The remote key set is cached and refetched on an unknown
 * `kid`, at most once per cooldown, so a key rotation needs no restart.
 */
export function createGithubOidcVerifier({
  audience,
  issuer = GITHUB_OIDC_ISSUER,
  jwksUrl = new URL(`${issuer}/.well-known/jwks`),
}: {
  audience: string;
  issuer?: string;
  jwksUrl?: URL;
}): OidcVerifier {
  const keys = createRemoteJWKSet(jwksUrl);

  return async (token) => {
    let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];
    try {
      ({payload} = await jwtVerify(token, keys, {
        issuer,
        audience,
        algorithms: ['RS256'],
        clockTolerance: CLOCK_SKEW_SECONDS,
        maxTokenAge: MAX_TOKEN_AGE_SECONDS,
        requiredClaims: ['exp', 'iat', 'jti'],
      }));
    } catch (error) {
      if (!(error instanceof errors.JOSEError) || ISSUER_FAILURE_CODES.has(error.code)) throw error;
      throw new PublishTokenRefusedError({
        reason: 'invalid-oidc-token',
        detail: error.message,
        cause: error,
      });
    }

    const claims = githubOidcClaimsSchema.safeParse(payload);
    if (!claims.success) {
      throw new PublishTokenRefusedError({
        reason: 'invalid-oidc-token',
        detail: describeIssues(claims.error),
      });
    }
    return claims.data;
  };
}

function isTokenId(value: string): boolean {
  try {
    registryJtiPath(value);
    return true;
  } catch {
    return false;
  }
}
