import type {RegistryBootstrap} from '#bootstrap.js';
import {buildCatalog, CATALOG_PAGE_SIZE, InvalidCursorError} from '#read/catalog.js';
import type {PublicPackage} from '#read/queries.js';

const bootstrap = {
  reserved: [],
  featured: [],
  namespaces: {
    shipfox: {status: 'active', profile: {display_name: 'Shipfox', verified: true}, publishers: []},
  },
} satisfies RegistryBootstrap;

function row(index: number): PublicPackage {
  return {
    name: `shipfox/package-${String(index).padStart(3, '0')}`,
    namespace: 'shipfox',
    kind: 'action',
    visibility: 'public',
    firstPublishedAt: new Date('2026-10-01T00:00:00Z'),
    title: `Package ${index}`,
    summary: 'A package.',
    keywords: [],
    integrations: [],
    latestVersion: '1.0.0',
    latestPublishedAt: new Date('2026-10-01T00:00:00Z'),
  };
}

describe('buildCatalog', () => {
  const rows = Array.from({length: CATALOG_PAGE_SIZE + 5}, (_, index) => row(index));

  it('pages through the entries with next_cursor', () => {
    const first = buildCatalog({rows, bootstrap, cursor: undefined});
    const second = buildCatalog({rows, bootstrap, cursor: first.next_cursor});

    expect(first.packages).toHaveLength(CATALOG_PAGE_SIZE);
    expect(second.packages).toHaveLength(5);
    expect(second.next_cursor).toBeUndefined();
    const names = [...first.packages, ...second.packages].map((entry) => entry.package);
    expect(new Set(names).size).toBe(rows.length);
  });

  it('rejects a cursor it did not issue', () => {
    expect(() => buildCatalog({rows, bootstrap, cursor: 'zzz'})).toThrow(InvalidCursorError);
  });
});
