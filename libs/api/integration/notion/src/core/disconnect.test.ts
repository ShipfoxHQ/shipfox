import {prepareNotionTokenRevocation} from './disconnect.js';

describe('prepareNotionTokenRevocation', () => {
  it('swallows and logs a revoke failure', async () => {
    const revokeToken = vi.fn().mockRejectedValue(new Error('Notion unavailable'));
    const cleanup = await prepareNotionTokenRevocation({
      connectionId: 'connection-id',
      tokenStore: {getAccessToken: vi.fn().mockResolvedValue('access-token')},
      notion: {revokeToken},
    });

    await expect(cleanup?.()).resolves.toBeUndefined();
    expect(revokeToken).toHaveBeenCalledWith({token: 'access-token'});
  });

  it('does not prepare a remote cleanup when the token cannot be read', async () => {
    const cleanup = await prepareNotionTokenRevocation({
      connectionId: 'connection-id',
      tokenStore: {getAccessToken: vi.fn().mockRejectedValue(new Error('missing'))},
      notion: {revokeToken: vi.fn()},
    });

    expect(cleanup).toBeUndefined();
  });
});
