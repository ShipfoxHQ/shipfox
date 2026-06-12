import {AUTH_LEASED_JOB, setLeasedJobContext} from '@shipfox/api-auth-context';
import {type AuthMethod, ClientError, extractBearerToken} from '@shipfox/node-fastify';
import {verifyJobLeaseToken} from '#core/job-lease-token.js';

/**
 * Trust boundary: the signed token is the sole authority — `claims.jobId` scopes
 * every runner request to exactly one job. `runId`/`workspaceId` are carried for
 * consumers but are NOT verified against the database here.
 *
 * Revocation tradeoff: `runnerTokenId` is carried in the claims but is not checked
 * against the runner-token table, so a lease minted before its runner token is
 * revoked stays usable until it expires (`AUTH_JOB_LEASE_TOKEN_EXPIRES_IN`, 90m).
 * Accepted deliberately for a short-lived, job-scoped capability token; tightening
 * this would mean a per-request DB lookup on the hot status-reporting path. See the
 * "Security model" section in the package README for the full rationale.
 */
export function createLeaseTokenAuthMethod(): AuthMethod {
  return {
    name: AUTH_LEASED_JOB,
    authenticate: async (request) => {
      const token = extractBearerToken(request.headers.authorization);
      if (!token) {
        throw new ClientError('Missing or invalid Authorization header', 'unauthorized', {
          status: 401,
        });
      }

      const claims = await verifyJobLeaseToken(token);
      if (!claims) {
        throw new ClientError('Invalid or expired job lease token', 'unauthorized', {status: 401});
      }

      setLeasedJobContext(request, claims);
    },
  };
}
