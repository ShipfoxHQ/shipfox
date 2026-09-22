import assert from 'node:assert/strict';
import test from 'node:test';
import type {SortedResult} from 'fumadocs-core/search';
import {codeLanguage, rankMatchedPageUrls, resolveCitationLink, truncatePage} from './ask-ai-core';

function result(url: string, type: SortedResult['type'] = 'heading'): SortedResult {
  return {id: url, url, type, content: url};
}

test('keeps the first hit of each page and drops the heading anchor', () => {
  const urls = rankMatchedPageUrls([
    result('/how-to/author-workflows/choose-runners#labels'),
    result('/how-to/author-workflows/choose-runners#pending'),
    result('/reference/workflow-schema', 'page'),
  ]);

  assert.deepEqual(urls, ['/how-to/author-workflows/choose-runners', '/reference/workflow-schema']);
});

test('stops at the page limit', () => {
  const urls = rankMatchedPageUrls(
    [result('/a'), result('/b'), result('/c'), result('/d'), result('/e')],
    2,
  );

  assert.deepEqual(urls, ['/a', '/b']);
});

test('returns nothing when the search finds nothing', () => {
  assert.deepEqual(rankMatchedPageUrls([]), []);
});

test('leaves a short page untouched', () => {
  assert.equal(truncatePage('# Runners\n\nShort page.'), '# Runners\n\nShort page.');
});

test('marks a long page as truncated', () => {
  const truncated = truncatePage('a'.repeat(10_000));

  assert.equal(truncated.startsWith('a'.repeat(8_000)), true);
  assert.equal(truncated.includes('[Page truncated.'), true);
});

test('prefixes a cited docs path with the deployed base path', () => {
  assert.deepEqual(resolveCitationLink('/understand/agents', '/docs'), {
    href: '/docs/understand/agents',
    external: false,
  });
});

test('leaves an absolute citation alone', () => {
  assert.deepEqual(resolveCitationLink('https://www.shipfox.io/docs/installation', '/docs'), {
    href: 'https://www.shipfox.io/docs/installation',
    external: true,
  });
});

test('reads the fenced code language, falling back to plain text', () => {
  assert.equal(codeLanguage('language-yaml'), 'yaml');
  assert.equal(codeLanguage('hljs language-bash extra'), 'bash');
  assert.equal(codeLanguage(undefined), 'text');
});
