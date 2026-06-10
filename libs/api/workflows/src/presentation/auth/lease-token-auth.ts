import {type JobLeaseTokenClaims, verifyJobLeaseToken} from '@shipfox/api-auth';
import {type AuthMethod, ClientError, extractBearerToken} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';

const JOB_LEASE_CONTEXT_KEY = 'jobLease';

export const LEASE_TOKEN_AUTH = 'lease-token';

/**
 * Trust boundary: the signed token is the sole authority — `claims.jobId` scopes
 * every step route to exactly one job. `runId`/`workspaceId` are carried for
 * consumers but are NOT verified against the database here.
 */
export function getLeaseTokenClaims(request: FastifyRequest): JobLeaseTokenClaims {
  const claims = (request as unknown as Record<string, unknown>)[JOB_LEASE_CONTEXT_KEY] as
    | JobLeaseTokenClaims
    | undefined;
  if (!claims) {
    throw new Error('Job lease claims are not available on this request');
  }
  return claims;
}

export function createLeaseTokenAuthMethod(): AuthMethod {
  return {
    name: LEASE_TOKEN_AUTH,
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

      (request as unknown as Record<string, unknown>)[JOB_LEASE_CONTEXT_KEY] = claims;
    },
  };
}
