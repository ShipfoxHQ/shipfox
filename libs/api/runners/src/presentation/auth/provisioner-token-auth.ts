import {
  AUTH_PROVISIONER_TOKEN,
  type ProvisionerContext,
  setProvisionerContext,
} from '@shipfox/api-auth-context';
import {type AuthMethod, ClientError, extractBearerToken} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {extractDisplayPrefix, getTokenType, hashOpaqueToken} from '@shipfox/node-tokens';
import {config} from '#config.js';
import {resolveProvisionerTokenByHash, touchProvisionerLastSeen} from '#db/provisioner-tokens.js';

type AuthFailureReason = 'missing' | 'type' | 'not-found' | 'revoked' | 'expired';

export function createProvisionerTokenAuthMethod(): AuthMethod {
  return {
    name: AUTH_PROVISIONER_TOKEN,
    authenticate: async (request) => {
      const rawToken = extractBearerToken(request.headers.authorization);
      if (!rawToken) {
        logAuthFailure({reason: 'missing'});
        throw new ClientError('Missing or invalid Authorization header', 'unauthorized', {
          status: 401,
        });
      }

      if (getTokenType(rawToken) !== 'provisionerToken') {
        logAuthFailure({rawToken, reason: 'type'});
        throw new ClientError('Invalid provisioner token', 'unauthorized', {status: 401});
      }

      const provisionerToken = await resolveProvisionerTokenByHash(hashOpaqueToken(rawToken));
      if (!provisionerToken) {
        logAuthFailure({rawToken, reason: 'not-found'});
        throw new ClientError('Invalid provisioner token', 'unauthorized', {status: 401});
      }

      if (provisionerToken.revokedAt) {
        logAuthFailure({rawToken, reason: 'revoked'});
        throw new ClientError('Provisioner token has been revoked', 'provisioner-token-revoked', {
          status: 401,
        });
      }

      if (provisionerToken.expiresAt && provisionerToken.expiresAt <= new Date()) {
        logAuthFailure({rawToken, reason: 'expired'});
        throw new ClientError('Provisioner token has expired', 'provisioner-token-expired', {
          status: 401,
        });
      }

      const context: ProvisionerContext = {
        provisionerTokenId: provisionerToken.id,
        workspaceId: provisionerToken.workspaceId,
      };

      await touchProvisionerLastSeen({
        tokenId: provisionerToken.id,
        throttleSeconds: config.PROVISIONER_LAST_SEEN_THROTTLE_SECONDS,
      }).catch((error: unknown) => {
        logger().warn({error, provisionerTokenId: provisionerToken.id}, 'last-seen touch failed');
      });

      setProvisionerContext(request, context);
    },
  };
}

function logAuthFailure(params: {rawToken?: string | undefined; reason: AuthFailureReason}): void {
  logger().warn(
    {
      prefix: params.rawToken ? extractDisplayPrefix(params.rawToken) : undefined,
      reason: params.reason,
    },
    'provisioner token auth failed',
  );
}
