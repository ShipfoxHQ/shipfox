const mocks = vi.hoisted(() => ({post: vi.fn()}));

vi.mock('ky', () => ({default: {post: mocks.post}}));

import {createNotionApiClient} from './client.js';

describe('createNotionApiClient', () => {
  beforeEach(() => {
    mocks.post.mockReset();
  });

  it('exchanges a code with HTTP Basic credentials and parses workspace identity', async () => {
    mocks.post.mockReturnValue({
      json: () =>
        Promise.resolve({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          bot_id: 'bot-id',
          workspace_id: 'workspace-id',
          workspace_name: 'Acme',
        }),
    });
    const client = createNotionApiClient();

    const result = await client.exchangeAuthorizationCode({code: 'authorization-code'});

    const [url, options] = mocks.post.mock.calls[0] as [
      string,
      {headers: Record<string, string>; json: Record<string, string>},
    ];
    expect(url).toBe('https://api.notion.com/v1/oauth/token');
    expect(options.headers.authorization).toBe(
      `Basic ${Buffer.from('test-client-id:test-client-secret').toString('base64')}`,
    );
    expect(options.json).toEqual({
      grant_type: 'authorization_code',
      code: 'authorization-code',
      redirect_uri: 'https://shipfox.example.com/integrations/notion/callback',
    });
    expect(result).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      botId: 'bot-id',
      workspaceId: 'workspace-id',
      workspaceName: 'Acme',
    });
  });

  it('refreshes with HTTP Basic credentials and parses the rotated pair', async () => {
    mocks.post.mockReturnValue({
      json: () =>
        Promise.resolve({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
        }),
    });
    const client = createNotionApiClient();

    const result = await client.refreshAccessToken({refreshToken: 'old-refresh-token'});

    const [url, options] = mocks.post.mock.calls[0] as [
      string,
      {headers: Record<string, string>; json: Record<string, string>},
    ];
    expect(url).toBe('https://api.notion.com/v1/oauth/token');
    expect(options.headers.authorization).toBe(
      `Basic ${Buffer.from('test-client-id:test-client-secret').toString('base64')}`,
    );
    expect(options.json).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'old-refresh-token',
    });
    expect(result).toEqual({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: undefined,
    });
  });

  it('revokes with HTTP Basic credentials and swallows no client error', async () => {
    mocks.post.mockResolvedValue(undefined);
    const client = createNotionApiClient();

    await client.revokeToken({token: 'access-token'});

    expect(mocks.post).toHaveBeenCalledWith('https://api.notion.com/v1/oauth/revoke', {
      headers: {
        authorization: `Basic ${Buffer.from('test-client-id:test-client-secret').toString('base64')}`,
      },
      json: {token: 'access-token'},
      timeout: 10_000,
    });
  });
});
