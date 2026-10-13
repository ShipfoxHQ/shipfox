import {
  CACHE_ENTRIES_DEFAULT_PAGE_LIMIT,
  CACHE_ENTRIES_MAX_PAGE_LIMIT,
  cacheProjectScopeParamsSchema,
  listCacheEntriesQuerySchema,
  updateCacheSettingsBodySchema,
} from './management.js';

describe('listCacheEntriesQuerySchema', () => {
  it('defaults the page size and reads it from a query string', () => {
    expect(listCacheEntriesQuerySchema.parse({}).limit).toBe(CACHE_ENTRIES_DEFAULT_PAGE_LIMIT);
    expect(listCacheEntriesQuerySchema.parse({limit: '5'}).limit).toBe(5);
  });

  it.each([0, CACHE_ENTRIES_MAX_PAGE_LIMIT + 1, 1.5])('rejects the page size %s', (limit) => {
    expect(listCacheEntriesQuerySchema.safeParse({limit}).success).toBe(false);
  });

  it('accepts a dev sandbox scope as the stored scope', () => {
    const query = listCacheEntriesQuerySchema.parse({
      scope: 'dev/user-1/main',
      key_prefix: 'pnpm-',
    });

    expect(query).toMatchObject({scope: 'dev/user-1/main', key_prefix: 'pnpm-'});
  });
});

describe('cacheProjectScopeParamsSchema', () => {
  it('holds a dev sandbox of the longest authored scope', () => {
    const scope = `dev/${crypto.randomUUID()}/${'x'.repeat(128)}`;

    expect(
      cacheProjectScopeParamsSchema.safeParse({projectId: crypto.randomUUID(), '*': scope}).success,
    ).toBe(true);
  });

  it('rejects a scope with characters a scope cannot hold', () => {
    const projectId = crypto.randomUUID();

    expect(cacheProjectScopeParamsSchema.safeParse({projectId, '*': 'main'}).success).toBe(true);
    expect(cacheProjectScopeParamsSchema.safeParse({projectId, '*': 'a b'}).success).toBe(false);
    expect(cacheProjectScopeParamsSchema.safeParse({projectId, '*': ''}).success).toBe(false);
  });
});

describe('updateCacheSettingsBodySchema', () => {
  it.each([1, 7, 90])('accepts %s days', (retention_days) => {
    expect(updateCacheSettingsBodySchema.safeParse({retention_days}).success).toBe(true);
  });

  it.each([0, -1, 2.5, '7'])('rejects %j', (retention_days) => {
    expect(updateCacheSettingsBodySchema.safeParse({retention_days}).success).toBe(false);
  });
});
