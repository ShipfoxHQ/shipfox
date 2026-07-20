import {AUTH_CAPACITY_BOOTSTRAP_CREDENTIAL} from '@shipfox/api-auth-context';
import {type AuthMethod, ClientError, extractBearerToken} from '@shipfox/node-fastify';
import {getTokenType, hashOpaqueToken} from '@shipfox/node-tokens';
import {resolveActiveCapacityBootstrapCredentialByHash} from '#db/index.js';

export function createCapacityBootstrapAuthMethod(): AuthMethod {
  return {
    name: AUTH_CAPACITY_BOOTSTRAP_CREDENTIAL,
    authenticate: async (request) => {
      const rawToken = extractBearerToken(request.headers.authorization);
      if (!rawToken || getTokenType(rawToken) !== 'capacityBootstrapCredential') {
        throw new ClientError('Invalid capacity bootstrap credential', 'unauthorized', {
          status: 401,
        });
      }
      const active = await resolveActiveCapacityBootstrapCredentialByHash(
        hashOpaqueToken(rawToken),
      );
      if (!active) {
        throw new ClientError('Invalid capacity bootstrap credential', 'unauthorized', {
          status: 401,
        });
      }
    },
  };
}
