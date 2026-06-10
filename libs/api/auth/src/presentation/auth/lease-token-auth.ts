import {AUTH_LEASED_JOB, setLeasedJobContext} from '@shipfox/api-auth-context';
import {type AuthMethod, ClientError, extractBearerToken} from '@shipfox/node-fastify';
import {verifyJobLeaseToken} from '#core/job-lease-token.js';

/**
 * Trust boundary: the signed token is the sole authority — `claims.jobId` scopes
 * every step route to exactly one job. `runId`/`workspaceId` are carried for
 * consumers but are NOT verified against the database here.
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
