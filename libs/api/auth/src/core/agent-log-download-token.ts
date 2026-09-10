import {
  AGENT_LOG_DOWNLOAD_TOKEN_AUDIENCE,
  type AgentLogDownloadTokenClaims,
  agentLogDownloadTokenClaimsSchema,
} from '@shipfox/api-auth-dto';
import {agentAccessTokenKey} from '@shipfox/node-auth-root-key';
import {signHs256, verifyHs256} from '@shipfox/node-jwt';
import {recordTokenIssued, recordTokenVerified} from '#metrics/index.js';

export const AGENT_LOG_DOWNLOAD_TOKEN_EXPIRES_IN = '5m';
export const AGENT_LOG_DOWNLOAD_TOKEN_EXPIRES_IN_SECONDS = 5 * 60;

export type IssueAgentLogDownloadTokenParams = Omit<
  AgentLogDownloadTokenClaims,
  'aud' | 'iat' | 'exp'
>;

export interface MintedAgentLogDownloadToken {
  token: string;
  expiresAt: Date;
}

export async function mintAgentLogDownloadToken(
  claims: IssueAgentLogDownloadTokenParams,
): Promise<MintedAgentLogDownloadToken> {
  const issuedAt = Date.now();
  const token = await signHs256({
    payload: {
      workspaceId: claims.workspaceId,
      grantId: claims.grantId,
      clientId: claims.clientId,
      streamId: claims.streamId,
    },
    secret: agentAccessTokenKey(),
    expiresIn: AGENT_LOG_DOWNLOAD_TOKEN_EXPIRES_IN,
    subject: claims.sub,
    audience: AGENT_LOG_DOWNLOAD_TOKEN_AUDIENCE,
  });
  recordTokenIssued('agent_log_download');
  return {
    token,
    expiresAt: new Date(issuedAt + AGENT_LOG_DOWNLOAD_TOKEN_EXPIRES_IN_SECONDS * 1000),
  };
}

export const issueAgentLogDownloadToken = mintAgentLogDownloadToken;

export async function verifyAgentLogDownloadToken(
  token: string,
): Promise<AgentLogDownloadTokenClaims | null> {
  const secret = agentAccessTokenKey();
  try {
    const claims = await verifyHs256({
      token,
      secret,
      schema: agentLogDownloadTokenClaimsSchema,
      audience: AGENT_LOG_DOWNLOAD_TOKEN_AUDIENCE,
    });
    recordTokenVerified('agent_log_download', 'ok');
    return claims;
  } catch {
    recordTokenVerified('agent_log_download', 'rejected');
    return null;
  }
}
