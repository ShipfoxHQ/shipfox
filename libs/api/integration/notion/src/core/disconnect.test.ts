const mocks = vi.hoisted(() => ({warn: vi.fn()}));

vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => ({warn: mocks.warn})}));

import {prepareNotionTokenRevocation} from './disconnect.js';

describe('prepareNotionTokenRevocation', () => {
  beforeEach(() => {
    mocks.warn.mockReset();
  });

  it('swallows and logs a revoke failure', async () => {
    const revokeError = new Error('Notion unavailable');
    const revokeToken = vi.fn().mockRejectedValue(revokeError);
    const cleanup = await prepareNotionTokenRevocation({
      connectionId: 'connection-id',
      tokenStore: {getAccessToken: vi.fn().mockResolvedValue('access-token')},
      notion: {revokeToken},
    });

    await expect(cleanup?.()).resolves.toBeUndefined();
    expect(revokeToken).toHaveBeenCalledWith({token: 'access-token'});
    expect(mocks.warn).toHaveBeenCalledWith(
      {err: revokeError, connectionId: 'connection-id'},
      'Notion token revocation failed during connection deletion',
    );
  });

  it('does not prepare a remote cleanup when the token cannot be read', async () => {
    const readError = new Error('missing');
    const cleanup = await prepareNotionTokenRevocation({
      connectionId: 'connection-id',
      tokenStore: {getAccessToken: vi.fn().mockRejectedValue(readError)},
      notion: {revokeToken: vi.fn()},
    });

    expect(cleanup).toBeUndefined();
    expect(mocks.warn).toHaveBeenCalledWith(
      {err: readError, connectionId: 'connection-id'},
      'Notion token revocation could not read the access token',
    );
  });
});
