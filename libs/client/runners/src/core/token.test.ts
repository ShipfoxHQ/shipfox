import {
  createTokenCommand,
  provisionerConnectionStatus,
  provisionerTokenDisplayName,
} from './token.js';

describe('token domain policies', () => {
  test('omits a blank token name while keeping its expiration policy', () => {
    const result = createTokenCommand('  ', {kind: 'expires-after', seconds: 86_400});

    expect(result).toEqual({expiration: {kind: 'expires-after', seconds: 86_400}});
  });

  test('derives provisioner status from active and last-seen state', () => {
    const token = {id: 'token-1', name: null, lastSeenAt: '2026-07-22T10:00:00.000Z'};

    expect(provisionerConnectionStatus(token, new Set(['token-1']))).toEqual({
      kind: 'connected',
      dotVariant: 'success',
      label: 'Connected',
    });
    expect(provisionerConnectionStatus(token, new Set())).toEqual({
      kind: 'last-seen',
      dotVariant: 'neutral',
      label: 'Last seen',
      lastSeenAt: token.lastSeenAt,
    });
    expect(provisionerTokenDisplayName(token)).toBe('Unnamed provisioner');
  });
});
