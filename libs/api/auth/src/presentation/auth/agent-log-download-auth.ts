import {AUTH_AGENT_LOG_DOWNLOAD, setAgentLogDownloadContext} from '@shipfox/api-auth-context';
import type {AgentLogDownloadTokenClaims} from '@shipfox/api-auth-dto';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {type AuthMethod, ClientError, type FastifyRequest} from '@shipfox/node-fastify';
import {checkAgentGrantAuthority} from '#core/agent-grant-authority.js';
import {verifyAgentLogDownloadToken} from '#core/agent-log-download-token.js';
import {AgentGrantAuthorityRevokedError, AuthDependencyUnavailableError} from '#core/errors.js';
import {createBearerTokenAuthMethod} from './bearer-token-auth.js';

const MAX_PRESENTED_TOKEN_BYTES = 8 * 1024;

class InvalidAgentLogDownloadCredentialError extends Error {
  constructor() {
    super('Invalid agent log download credential');
    this.name = 'InvalidAgentLogDownloadCredentialError';
  }
}

function invalidCredential(): never {
  throw new InvalidAgentLogDownloadCredentialError();
}

async function verifyAgentLogDownloadCredential(
  token: string,
  workspaces: WorkspacesInterModuleClient,
): Promise<AgentLogDownloadTokenClaims> {
  if (Buffer.byteLength(token, 'utf8') > MAX_PRESENTED_TOKEN_BYTES) return invalidCredential();

  const claims = await verifyAgentLogDownloadToken(token);
  if (!claims) return invalidCredential();

  try {
    await checkAgentGrantAuthority({
      grantId: claims.grantId,
      userId: claims.sub,
      workspaceId: claims.workspaceId,
      workspaces,
    });
  } catch (error) {
    if (error instanceof AgentGrantAuthorityRevokedError) return invalidCredential();
    if (error instanceof AuthDependencyUnavailableError) {
      throw new ClientError(
        'Authentication dependency unavailable',
        'auth-dependency-unavailable',
        {status: 503, cause: error},
      );
    }
    throw error;
  }

  return claims;
}

export function createAgentLogDownloadAuthMethod(
  workspaces: WorkspacesInterModuleClient,
): AuthMethod {
  return createBearerTokenAuthMethod({
    name: AUTH_AGENT_LOG_DOWNLOAD,
    verifyToken: (token) => verifyAgentLogDownloadCredential(token, workspaces),
    isInvalidTokenError: (error) => error instanceof InvalidAgentLogDownloadCredentialError,
    invalidTokenError: {
      message: 'Invalid or expired agent log download token',
      code: 'unauthorized',
    },
    setContext: (request: FastifyRequest, claims) => {
      setAgentLogDownloadContext(request, {
        userId: claims.sub,
        workspaceId: claims.workspaceId,
        grantId: claims.grantId,
        streamId: claims.streamId,
      });
    },
  });
}
