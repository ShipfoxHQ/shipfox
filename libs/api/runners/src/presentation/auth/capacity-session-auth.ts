import {AUTH_CAPACITY_SESSION, setCapacitySessionContext} from '@shipfox/api-auth-context';
import {type AuthMethod, ClientError, extractBearerToken} from '@shipfox/node-fastify';
import {getTokenType, hashOpaqueToken} from '@shipfox/node-tokens';
import {resolveCapacitySessionByHash, touchCapacitySession} from '#db/index.js';

export function createCapacitySessionAuthMethod(): AuthMethod {
  return {
    name: AUTH_CAPACITY_SESSION,
    authenticate: async (request) => {
      const rawToken = extractBearerToken(request.headers.authorization);
      if (!rawToken || getTokenType(rawToken) !== 'capacitySession') {
        throw new ClientError('Invalid capacity session', 'unauthorized', {status: 401});
      }
      const session = await resolveCapacitySessionByHash(hashOpaqueToken(rawToken));
      if (!session || session.closedAt || session.expiresAt <= new Date()) {
        throw new ClientError('Invalid capacity session', 'unauthorized', {status: 401});
      }
      await touchCapacitySession({sessionId: session.id});
      setCapacitySessionContext(request, {
        sessionId: session.id,
        capacityId: session.capacityId,
        provisionerId: session.provisionerId,
      });
    },
  };
}
