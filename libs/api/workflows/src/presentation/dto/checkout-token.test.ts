import type {CheckoutSpec} from '@shipfox/api-integration-core';
import {toCheckoutTokenDto} from './checkout-token.js';

describe('toCheckoutTokenDto', () => {
  it('maps credentials to basic auth with an ISO expiry', () => {
    const spec: CheckoutSpec = {
      repositoryUrl: 'https://github.com/acme/repo.git',
      ref: 'main',
      credentials: {
        username: 'x-access-token',
        token: 'ghs-token',
        expiresAt: new Date('2026-06-10T12:00:00.000Z'),
      },
      permissions: {contents: 'write'},
      ephemeral: true,
    };

    const dto = toCheckoutTokenDto(spec);

    expect(dto).toEqual({
      repository_url: 'https://github.com/acme/repo.git',
      ref: 'main',
      auth: {
        kind: 'basic',
        username: 'x-access-token',
        token: 'ghs-token',
        expires_at: '2026-06-10T12:00:00.000Z',
      },
      permissions: {contents: 'write'},
      ephemeral: true,
    });
  });

  it('omits auth when the spec has no credentials', () => {
    const spec: CheckoutSpec = {repositoryUrl: 'https://example.com/acme/repo.git', ref: 'trunk'};

    const dto = toCheckoutTokenDto(spec);

    expect(dto).toEqual({repository_url: 'https://example.com/acme/repo.git', ref: 'trunk'});
    expect(dto.auth).toBeUndefined();
    expect(dto.permissions).toBeUndefined();
    expect(dto.ephemeral).toBeUndefined();
  });

  it('rejects a repository URL that embeds credentials', () => {
    const spec: CheckoutSpec = {
      repositoryUrl: 'https://x-access-token:ghs-token@github.com/acme/repo.git',
      ref: 'main',
    };

    expect(() => toCheckoutTokenDto(spec)).toThrow();
  });

  it('rejects an scp-like URL that embeds credentials', () => {
    const spec: CheckoutSpec = {
      repositoryUrl: 'user:secret@github.com:acme/repo.git',
      ref: 'main',
    };

    expect(() => toCheckoutTokenDto(spec)).toThrow();
  });

  it('accepts a credential-free scp-like URL', () => {
    const spec: CheckoutSpec = {repositoryUrl: 'git@github.com:acme/repo.git', ref: 'main'};

    const dto = toCheckoutTokenDto(spec);

    expect(dto).toEqual({repository_url: 'git@github.com:acme/repo.git', ref: 'main'});
  });
});
