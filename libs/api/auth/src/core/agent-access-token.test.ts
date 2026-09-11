import {AGENT_ACCESS_TOKEN_AUDIENCE} from '@shipfox/api-auth-dto';
import {agentAccessTokenKey, userAccessTokenKey} from '@shipfox/node-auth-root-key';
import {signHs256} from '@shipfox/node-jwt';
import {issueAgentAccessToken, verifyAgentAccessToken} from './agent-access-token.js';
import {signUserToken, verifyUserToken} from './jwt.js';

function claims() {
  return {
    sub: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    grantId: crypto.randomUUID(),
    clientId: 'client_123',
  };
}

describe('agent-access-token', () => {
  test('issues and verifies a token with its dedicated signing key', async () => {
    const input = claims();

    const token = await issueAgentAccessToken(input);
    const verified = await verifyAgentAccessToken(token);

    expect(verified).toMatchObject(input);
  });

  test('keeps the legacy scopes claim while old verifiers may still serve', async () => {
    const token = await issueAgentAccessToken(claims());
    const [, encodedPayload] = token.split('.');

    if (encodedPayload === undefined) throw new Error('Token payload is missing');
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      scopes?: unknown;
    };
    expect(payload.scopes).toEqual(['read']);
  });

  test('accepts legacy tokens that still carry the removed scopes claim', async () => {
    const input = claims();
    const token = await signHs256({
      payload: {...input, scopes: ['read']},
      secret: agentAccessTokenKey(),
      expiresIn: '15m',
      subject: input.sub,
      audience: AGENT_ACCESS_TOKEN_AUDIENCE,
    });

    await expect(verifyAgentAccessToken(token)).resolves.toMatchObject(input);
  });

  test('does not cross-verify agent and session tokens', async () => {
    const input = claims();
    const agentToken = await issueAgentAccessToken(input);

    await expect(
      verifyUserToken({token: agentToken, secret: userAccessTokenKey()}),
    ).rejects.toThrow();

    const sessionToken = await signUserToken({
      userId: input.sub,
      email: 'agent@example.test',
      memberships: [],
      secret: userAccessTokenKey(),
      expiresIn: '15m',
    });

    expect(await verifyAgentAccessToken(sessionToken)).toBeNull();
    expect(agentAccessTokenKey()).not.toEqual(userAccessTokenKey());
  });
});
