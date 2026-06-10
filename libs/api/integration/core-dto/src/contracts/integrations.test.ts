import {type CheckoutSpec, redactCheckoutSpec} from './integrations.js';

describe('redactCheckoutSpec', () => {
  it('masks the credential token while keeping the other fields intact', () => {
    const expiresAt = new Date('2026-06-10T12:00:00.000Z');
    const spec: CheckoutSpec = {
      repositoryUrl: 'https://github.com/shipfox/platform.git',
      ref: 'main',
      credentials: {username: 'x-access-token', token: 'ghs_supersecret', expiresAt},
    };

    const redacted = redactCheckoutSpec(spec);

    expect(redacted).toEqual({
      repositoryUrl: 'https://github.com/shipfox/platform.git',
      ref: 'main',
      credentials: {username: 'x-access-token', token: '***', expiresAt},
    });
  });

  it('does not mutate the original spec', () => {
    const spec: CheckoutSpec = {
      repositoryUrl: 'https://github.com/shipfox/platform.git',
      ref: 'main',
      credentials: {
        username: 'x-access-token',
        token: 'ghs_supersecret',
        expiresAt: new Date('2026-06-10T12:00:00.000Z'),
      },
    };

    redactCheckoutSpec(spec);

    expect(spec.credentials?.token).toBe('ghs_supersecret');
  });

  it('returns the spec unchanged when there are no credentials', () => {
    const spec: CheckoutSpec = {
      repositoryUrl: 'https://debug.local/debug-owner/platform.git',
      ref: 'main',
    };

    const redacted = redactCheckoutSpec(spec);

    expect(redacted).toBe(spec);
  });
});
