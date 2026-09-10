import {z} from 'zod';

export const AGENT_LOG_DOWNLOAD_TOKEN_AUDIENCE = 'agent-log-download';

export const agentLogDownloadTokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  workspaceId: z.string().uuid(),
  grantId: z.string().uuid(),
  clientId: z.string().min(1).max(2048),
  streamId: z.string().uuid(),
  aud: z.literal(AGENT_LOG_DOWNLOAD_TOKEN_AUDIENCE),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type AgentLogDownloadTokenClaims = z.infer<typeof agentLogDownloadTokenClaimsSchema>;
