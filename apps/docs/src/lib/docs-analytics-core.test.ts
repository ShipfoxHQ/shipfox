import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  buildDocsEventProperties,
  destinationFromHref,
  nextCatalogSearchState,
  normalizeCatalogQuery,
  normalizeDocsLocation,
  sanitizePosthogCapture,
  sanitizeTrackedUrl,
} from './docs-analytics-core';

describe('normalizeCatalogQuery', () => {
  it('normalizes a catalog query and preserves its length', () => {
    const query = normalizeCatalogQuery('  Source   Control  ');

    assert.deepEqual(query, {
      query: 'source control',
      queryLength: 14,
      queryRedacted: false,
      dedupeKey: 'source control',
    });
  });

  it('limits the transmitted query without changing its measured length', () => {
    const value = 'integration '.repeat(10).trim();
    const query = normalizeCatalogQuery(value);

    assert.equal(query.query, value.slice(0, 100));
    assert.equal(query.queryLength, value.length);
    assert.equal(query.queryRedacted, false);
  });

  for (const [name, value] of [
    ['email', 'person@example.com'],
    ['URL', 'https://example.com/private'],
    ['credential assignment', 'client_secret=private-value'],
    ['token-like value', 'prefix-abc123def456abc123def456abc123def456-suffix'],
  ]) {
    it(`redacts a query containing a ${name}`, () => {
      const query = normalizeCatalogQuery(value);

      assert.equal(query.query, '[redacted]');
      assert.equal(query.queryRedacted, true);
    });
  }
});

describe('nextCatalogSearchState', () => {
  it('deduplicates consecutive queries and resets after clearing', () => {
    const first = nextCatalogSearchState(null, 'github');
    const duplicate = nextCatalogSearchState(first.lastQuery, 'github');
    const cleared = nextCatalogSearchState(duplicate.lastQuery, '');
    const repeated = nextCatalogSearchState(cleared.lastQuery, 'github');

    assert.equal(first.capture, true);
    assert.equal(duplicate.capture, false);
    assert.deepEqual(cleared, {capture: false, lastQuery: null});
    assert.equal(repeated.capture, true);
  });
});

describe('docs URL analytics', () => {
  it('builds versioned docs event properties from a production path', () => {
    const properties = buildDocsEventProperties('/docs/integrations/github', '/docs', {
      provider: 'github',
    });

    assert.deepEqual(properties, {
      surface: 'docs',
      page_path: '/integrations/github',
      docs_section: 'integrations',
      schema_version: 1,
      provider: 'github',
    });
  });

  it('normalizes production and preview docs paths', () => {
    const production = normalizeDocsLocation('/docs/integrations/github/', '/docs');
    const preview = normalizeDocsLocation('/integrations/github/', '');

    assert.deepEqual(production, {pagePath: '/integrations/github', docsSection: 'integrations'});
    assert.deepEqual(preview, production);
    assert.deepEqual(normalizeDocsLocation('/docs', '/docs'), {
      pagePath: '/',
      docsSection: 'home',
    });
  });

  it('removes query strings and fragments from absolute and relative URLs', () => {
    assert.equal(
      sanitizeTrackedUrl('https://www.shipfox.io/docs?token=secret#section'),
      'https://www.shipfox.io/docs',
    );
    assert.equal(sanitizeTrackedUrl('/docs/integrations?query=github'), '/docs/integrations');
  });

  it('sanitizes PostHog URL and referrer properties', () => {
    const result = sanitizePosthogCapture({
      uuid: '44b92a46-956f-4e6b-9994-d524f26f8d30',
      event: '$pageview',
      properties: {
        $current_url: 'https://www.shipfox.io/docs?secret=value',
        $referrer: 'https://example.com/source?campaign=private',
        $session_entry_url: 'https://www.shipfox.io/docs?from=private#section',
        retained: 'value',
      },
    });

    assert.deepEqual(result?.properties, {
      $current_url: 'https://www.shipfox.io/docs',
      $referrer: 'https://example.com/source',
      $session_entry_url: 'https://www.shipfox.io/docs',
      retained: 'value',
    });
  });

  it('classifies HTTP destinations without retaining query strings', () => {
    const destination = destinationFromHref(
      'https://github.com/ShipfoxHQ/shipfox?tab=readme#readme',
      'https://www.shipfox.io/docs',
    );

    assert.deepEqual(destination, {
      origin: 'https://github.com',
      pathname: '/ShipfoxHQ/shipfox',
    });
    assert.equal(destinationFromHref('mailto:hello@shipfox.io', 'https://www.shipfox.io'), null);
  });
});
