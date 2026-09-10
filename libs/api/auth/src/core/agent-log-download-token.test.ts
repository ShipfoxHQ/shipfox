import {AGENT_LOG_DOWNLOAD_TOKEN_AUDIENCE} from '@shipfox/api-auth-dto';
import {agentAccessTokenKey} from '@shipfox/node-auth-root-key';
import {signHs256} from '@shipfox/node-jwt';
import {
  mintAgentLogDownloadToken,
  verifyAgentLogDownloadToken,
} from './agent-log-download-token.js';

describe('agent-log-download-token', () => {
  const claims = {
    sub: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    grantId: crypto.randomUUID(),
    clientId: 'https://client.example.test/cimd.json',
    streamId: crypto.randomUUID(),
  };

  test('issues and verifies a five-minute stream-bound token', async () => {
    const before = Date.now();
    const result = await mintAgentLogDownloadToken(claims);
    const after = Date.now();

    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 5 * 60 * 1000);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + 5 * 60 * 1000);
    await expect(verifyAgentLogDownloadToken(result.token)).resolves.toMatchObject(claims);
  });

  test('rejects the agent-access audience', async () => {
    const token = await signHs256({
      payload: {
        workspaceId: claims.workspaceId,
        grantId: claims.grantId,
        clientId: claims.clientId,
        streamId: claims.streamId,
      },
      secret: agentAccessTokenKey(),
      expiresIn: '5m',
      subject: claims.sub,
      audience: 'agent-access',
    });

    await expect(verifyAgentLogDownloadToken(token)).resolves.toBeNull();
  });

  test('rejects an expired download token', async () => {
    const token = await signHs256({
      payload: {
        workspaceId: claims.workspaceId,
        grantId: claims.grantId,
        clientId: claims.clientId,
        streamId: claims.streamId,
      },
      secret: agentAccessTokenKey(),
      expiresIn: '-1s',
      subject: claims.sub,
      audience: AGENT_LOG_DOWNLOAD_TOKEN_AUDIENCE,
    });

    await expect(verifyAgentLogDownloadToken(token)).resolves.toBeNull();
  });

  test('rejects a download token as agent access', async () => {
    const token = await signHs256({
      payload: {
        workspaceId: claims.workspaceId,
        grantId: claims.grantId,
        clientId: claims.clientId,
        streamId: claims.streamId,
      },
      secret: agentAccessTokenKey(),
      expiresIn: '5m',
      subject: claims.sub,
      audience: AGENT_LOG_DOWNLOAD_TOKEN_AUDIENCE,
    });
    const {verifyAgentAccessToken} = await import('./agent-access-token.js');

    await expect(verifyAgentAccessToken(token)).resolves.toBeNull();
  });
});
