import {checkoutTokenResponseSchema} from './checkout-token.js';

const bearerResponse = {
  repository_url: 'https://github.com/acme/repo.git',
  ref: 'main',
  auth: {
    kind: 'bearer',
    token: 'gh-token',
    expires_at: '2026-06-10T12:00:00.000Z',
  },
};

const basicResponse = {
  repository_url: 'https://github.com/acme/repo.git',
  ref: 'main',
  auth: {
    kind: 'basic',
    username: 'x-access-token',
    token: 'gh-token',
    expires_at: '2026-06-10T12:00:00.000Z',
  },
};

describe('checkoutTokenResponseSchema', () => {
  it('accepts and round-trips a bearer auth response (no username)', () => {
    const result = checkoutTokenResponseSchema.parse(bearerResponse);

    expect(result).toEqual(bearerResponse);
  });

  it('accepts and round-trips a basic auth response with a username', () => {
    const result = checkoutTokenResponseSchema.parse(basicResponse);

    expect(result).toEqual(basicResponse);
  });

  it('accepts a credential-free response with no auth (debug provider)', () => {
    const input = {repository_url: 'https://github.com/acme/repo.git', ref: 'main'};

    const result = checkoutTokenResponseSchema.parse(input);

    expect(result).toEqual(input);
    expect(result.auth).toBeUndefined();
  });

  it('accepts granted checkout permissions and ephemeral metadata', () => {
    const input = {
      ...basicResponse,
      permissions: {contents: 'write'},
      ephemeral: true,
    };

    const result = checkoutTokenResponseSchema.parse(input);

    expect(result.permissions).toEqual({contents: 'write'});
    expect(result.ephemeral).toBe(true);
  });

  it('rejects an unknown checkout permission level', () => {
    const input = {...basicResponse, permissions: {contents: 'admin'}};

    const parse = () => checkoutTokenResponseSchema.parse(input);

    expect(parse).toThrow();
  });

  it('rejects basic auth missing a username', () => {
    const {username: _username, ...basicAuthWithoutUsername} = basicResponse.auth;
    const input = {...basicResponse, auth: basicAuthWithoutUsername};

    const parse = () => checkoutTokenResponseSchema.parse(input);

    expect(parse).toThrow();
  });

  it('rejects an unknown auth kind', () => {
    const input = {...bearerResponse, auth: {...bearerResponse.auth, kind: 'oauth'}};

    const parse = () => checkoutTokenResponseSchema.parse(input);

    expect(parse).toThrow();
  });

  it('rejects a malformed (non-ISO) expires_at', () => {
    const input = {...bearerResponse, auth: {...bearerResponse.auth, expires_at: 'soon'}};

    const parse = () => checkoutTokenResponseSchema.parse(input);

    expect(parse).toThrow();
  });

  it('accepts the toISOString() Z wire format for expires_at', () => {
    const input = {
      ...bearerResponse,
      auth: {...bearerResponse.auth, expires_at: '2026-06-10T12:00:00.000Z'},
    };

    const result = checkoutTokenResponseSchema.parse(input);

    expect(result.auth?.expires_at).toBe('2026-06-10T12:00:00.000Z');
  });

  it('accepts an offset (non-Z) expires_at', () => {
    const input = {
      ...bearerResponse,
      auth: {...bearerResponse.auth, expires_at: '2026-06-10T12:00:00+02:00'},
    };

    const result = checkoutTokenResponseSchema.parse(input);

    expect(result.auth?.expires_at).toBe('2026-06-10T12:00:00+02:00');
  });

  it('rejects an empty token', () => {
    const input = {...bearerResponse, auth: {...bearerResponse.auth, token: ''}};

    const parse = () => checkoutTokenResponseSchema.parse(input);

    expect(parse).toThrow();
  });

  it('rejects an empty repository_url', () => {
    const input = {...bearerResponse, repository_url: ''};

    const parse = () => checkoutTokenResponseSchema.parse(input);

    expect(parse).toThrow();
  });
});
