import {type ApiKeyContext, AUTH_API_KEY, setApiKeyContext} from '@shipfox/api-auth-context';
import {type AuthMethod, ClientError, extractBearerToken} from '@shipfox/node-fastify';
import {hashOpaqueToken} from '@shipfox/node-tokens';
import {resolveApiKeyWithWorkspace} from '#db/resolve-api-key.js';

export function createApiKeyAuthMethod(): AuthMethod {
  return {
    name: AUTH_API_KEY,
    authenticate: async (request) => {
      const rawKey = extractBearerToken(request.headers.authorization);
      if (!rawKey) {
        throw new ClientError('Missing or invalid Authorization header', 'unauthorized', {
          status: 401,
        });
      }

      const hashedKey = hashOpaqueToken(rawKey);
      const result = await resolveApiKeyWithWorkspace(hashedKey);
      if (!result) {
        throw new ClientError('Invalid API key', 'unauthorized', {status: 401});
      }

      const {apiKey, workspace} = result;

      if (apiKey.revokedAt) {
        throw new ClientError('API key has been revoked', 'api-key-revoked', {status: 401});
      }

      if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
        throw new ClientError('API key has expired', 'api-key-expired', {status: 401});
      }

      if (workspace.status !== 'active') {
        throw new ClientError('Workspace is not active', 'workspace-inactive', {status: 403});
      }

      const apiKeyContext: ApiKeyContext = {
        apiKeyId: apiKey.id,
        workspaceId: workspace.id,
        workspaceStatus: workspace.status,
        scopes: apiKey.scopes,
      };

      setApiKeyContext(request, apiKeyContext);
    },
  };
}
