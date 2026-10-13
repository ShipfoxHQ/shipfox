import {
  CACHE_FALLBACK_SCOPES_MAX,
  CACHE_RESTORE_KEYS_MAX,
  cacheCommitBodySchema,
  cacheReserveBodySchema,
  cacheRestoreBodySchema,
} from './runner-routes.js';

const sha256 = 'a'.repeat(64);

describe('cacheRestoreBodySchema', () => {
  it('defaults the optional lists to empty', () => {
    const body = cacheRestoreBodySchema.parse({scope: 'default', key: 'pnpm-abc', version: 'v1'});

    expect(body.fallback_scopes).toEqual([]);
    expect(body.restore_keys).toEqual([]);
  });

  it('bounds the fallback scopes and restore keys', () => {
    const base = {scope: 'default', key: 'k', version: 'v1'};

    const tooManyScopes = cacheRestoreBodySchema.safeParse({
      ...base,
      fallback_scopes: Array.from({length: CACHE_FALLBACK_SCOPES_MAX + 1}, () => 'x'),
    });
    const tooManyKeys = cacheRestoreBodySchema.safeParse({
      ...base,
      restore_keys: Array.from({length: CACHE_RESTORE_KEYS_MAX + 1}, () => 'x'),
    });

    expect(tooManyScopes.success).toBe(false);
    expect(tooManyKeys.success).toBe(false);
  });

  it.each(['', 'has space', 'semi;colon', 'a'.repeat(129)])('rejects the scope %j', (scope) => {
    const parsed = cacheRestoreBodySchema.safeParse({scope, key: 'k', version: 'v1'});

    expect(parsed.success).toBe(false);
  });
});

describe('cacheKeySchema', () => {
  it('rejects a NUL character, which Postgres cannot store', () => {
    const parsed = cacheRestoreBodySchema.safeParse({
      scope: 'default',
      key: 'pnpm-\u0000-abc',
      version: 'v1',
    });
    const inRestoreKeys = cacheRestoreBodySchema.safeParse({
      scope: 'default',
      key: 'k',
      restore_keys: ['pnpm-\u0000'],
      version: 'v1',
    });

    expect(parsed.success).toBe(false);
    expect(inRestoreKeys.success).toBe(false);
  });
});

describe('cacheReserveBodySchema', () => {
  it('requires a positive size and a lowercase sha256', () => {
    const base = {scope: 'default', key: 'k', version: 'v1'};

    expect(cacheReserveBodySchema.safeParse({...base, size_bytes: 0, sha256}).success).toBe(false);
    expect(
      cacheReserveBodySchema.safeParse({...base, size_bytes: 1, sha256: sha256.toUpperCase()})
        .success,
    ).toBe(false);
    expect(cacheReserveBodySchema.safeParse({...base, size_bytes: 1, sha256}).success).toBe(true);
  });
});

describe('cacheCommitBodySchema', () => {
  it('requires at least one part', () => {
    expect(cacheCommitBodySchema.safeParse({parts: []}).success).toBe(false);
    expect(cacheCommitBodySchema.safeParse({parts: [{number: 1, etag: '"abc"'}]}).success).toBe(
      true,
    );
  });
});
