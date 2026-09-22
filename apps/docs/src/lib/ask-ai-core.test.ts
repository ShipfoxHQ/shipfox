import assert from 'node:assert/strict';
import test from 'node:test';
import {
  codeLanguage,
  normalizePagePath,
  renderPageCatalog,
  resolveCitationLink,
} from './ask-ai-core';

test('renders the catalog as a path and a description per page', () => {
  const catalog = renderPageCatalog([
    {
      label: 'Reference',
      pages: [
        {title: 'Workflow schema', description: 'Every workflow field.', url: '/reference/schema'},
        {title: 'Glossary', description: 'Terms used across Shipfox.', url: '/reference/glossary'},
      ],
    },
    {
      label: 'Integrations',
      pages: [{title: 'Linear tools', description: 'The Linear tool catalog.', url: '/linear'}],
    },
  ]);

  assert.equal(
    catalog,
    [
      '## Reference',
      '',
      '- [Workflow schema](/reference/schema): Every workflow field.',
      '- [Glossary](/reference/glossary): Terms used across Shipfox.',
      '',
      '## Integrations',
      '',
      '- [Linear tools](/linear): The Linear tool catalog.',
    ].join('\n'),
  );
});

test('renders nothing for an empty catalog', () => {
  assert.equal(renderPageCatalog([]), '');
});

test('keeps a catalog path unchanged', () => {
  assert.equal(normalizePagePath('/integrations/linear/tools'), '/integrations/linear/tools');
});

test('strips the deployed path prefix from a canonical page URL', () => {
  assert.equal(
    normalizePagePath('https://www.shipfox.io/docs/integrations/linear/tools'),
    '/integrations/linear/tools',
  );
  assert.equal(normalizePagePath('/docs/reference/glossary'), '/reference/glossary');
});

test('resolves the docs root to the index page', () => {
  assert.equal(normalizePagePath('https://www.shipfox.io/docs'), '/');
  assert.equal(normalizePagePath('/docs'), '/');
});

test('drops an anchor, a query, and a trailing slash', () => {
  assert.equal(normalizePagePath('/reference/contexts#event'), '/reference/contexts');
  assert.equal(normalizePagePath('/reference/contexts?utm=1'), '/reference/contexts');
  assert.equal(normalizePagePath('/reference/contexts/'), '/reference/contexts');
});

test('accepts a path the model wrote without its leading slash', () => {
  assert.equal(normalizePagePath('understand/agents'), '/understand/agents');
});

test('leaves an unparseable reference alone rather than inventing a path', () => {
  assert.equal(normalizePagePath(''), '');
  assert.equal(normalizePagePath('https://'), 'https://');
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
