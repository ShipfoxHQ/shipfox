import {createDocsCache, DocsUnavailableError} from './docs.js';

const index = [
  '# Shipfox Documentation',
  '- [How Shipfox works](https://docs.example.test/docs/understand): Learn the concepts.',
  '- [Workflow schema](https://docs.example.test/docs/reference/workflow-schema): Read the schema.',
].join('\n');

describe('documentation host cache', () => {
  test('validates configuration and disables all host access for an empty URL', async () => {
    const fetcher = vi.fn();
    const docs = createDocsCache({baseUrl: '', fetch: fetcher});
    docs.start();
    expect(docs.enabled).toBe(false);
    await expect(docs.readIndex()).rejects.toBeInstanceOf(DocsUnavailableError);
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => createDocsCache({baseUrl: 'file:///tmp/docs'})).toThrow('DOCS_BASE_URL');
    expect(() => createDocsCache({baseUrl: 'https://user:pass@docs.example.test'})).toThrow(
      'DOCS_BASE_URL',
    );
  });

  test('revalidates the index and pages with ETags and keeps warm content on outage', async () => {
    let time = 0;
    let outage = false;
    let indexVersion = 1;
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the stub models index and page ETag responses and outages.
    const fetcher = vi.fn((input: URL, init?: RequestInit) => {
      if (outage) throw new Error('host down');
      if (input.pathname.endsWith('llms.txt')) {
        if (init?.headers && 'If-None-Match' in init.headers && indexVersion === 1) {
          return new Response(null, {status: 304});
        }
        return new Response(
          indexVersion === 1 ? index : index.replace('Workflow schema', 'Updated schema'),
          {
            headers: {etag: `index-${indexVersion}`},
          },
        );
      }
      if (input.pathname.endsWith('llms.mdx/understand')) {
        if (init?.headers && 'If-None-Match' in init.headers)
          return new Response(null, {status: 304});
        return new Response('# How Shipfox works', {headers: {etag: 'page-1'}});
      }
      throw new Error(`Unexpected URL ${input}`);
    });
    let refresh: (() => void) | undefined;
    const docs = createDocsCache({
      baseUrl: 'https://docs.example.test/docs',
      fetch: fetcher as unknown as typeof fetch,
      now: () => time,
      setInterval: ((callback: () => void) => {
        refresh = callback;
        return {unref: () => undefined} as unknown as NodeJS.Timeout;
      }) as typeof setInterval,
    });
    docs.start();
    await docs.readIndex();
    expect(await docs.hasSlug('understand')).toBe(true);
    expect(await docs.hasSlug('missing')).toBe(false);
    expect(await docs.readPage('understand')).toMatchObject({
      text: '# How Shipfox works',
      cached: false,
    });
    expect((await docs.readPage('understand')).cached).toBe(true);

    time += 60 * 60_000;
    expect(docs.isPageCached('understand')).toBe(false);
    expect(await docs.readPage('understand')).toMatchObject({text: '# How Shipfox works'});
    expect(fetcher).toHaveBeenCalledWith(
      new URL('https://docs.example.test/docs/llms.mdx/understand'),
      {headers: {'If-None-Match': 'page-1'}},
    );
    refresh?.();
    await docs.readIndex();
    expect(fetcher).toHaveBeenCalledWith(new URL('https://docs.example.test/docs/llms.txt'), {
      headers: {'If-None-Match': 'index-1'},
    });

    outage = true;
    time += 60 * 60_000;
    expect((await docs.readPage('understand')).text).toBe('# How Shipfox works');
    refresh?.();
    expect((await docs.readIndex()).text).toBe(index);
    outage = false;
    indexVersion = 2;
    refresh?.();
    await vi.waitFor(async () => expect((await docs.readIndex()).text).toContain('Updated schema'));
  });

  test('cold outage fails reads and a later refresh recovers', async () => {
    let outage = true;
    let refresh: (() => void) | undefined;
    const docs = createDocsCache({
      baseUrl: 'https://docs.example.test/docs',
      fetch: vi.fn(() => {
        if (outage) throw new Error('host down');
        return new Response(index);
      }) as unknown as typeof fetch,
      setInterval: ((callback: () => void) => {
        refresh = callback;
        return {unref: () => undefined} as unknown as NodeJS.Timeout;
      }) as typeof setInterval,
    });
    docs.start();
    await expect(docs.readIndex()).rejects.toBeInstanceOf(DocsUnavailableError);
    outage = false;
    refresh?.();
    await vi.waitFor(async () => expect(await docs.hasSlug('understand')).toBe(true));
  });

  test('maps ranked search results to five distinct documentation resources', async () => {
    const searchIndex = [
      index,
      ...Array.from(
        {length: 6},
        (_, i) => `- [Page ${i}](https://docs.example.test/docs/reference/page-${i}): Example.`,
      ),
    ].join('\n');
    const results = [
      {type: 'page', url: '/understand', content: 'How <mark>Shipfox</mark> works'},
      {type: 'text', url: '/understand#jobs', content: 'Agent <mark>jobs</mark>'},
      ...Array.from({length: 6}, (_, i) => ({url: `/reference/page-${i}`, content: `Page ${i}`})),
    ];
    const fetcher = vi.fn(
      (target: URL) =>
        new Response(target.pathname.endsWith('llms.txt') ? searchIndex : JSON.stringify(results)),
    );
    const docs = createDocsCache({
      baseUrl: 'https://docs.example.test/docs',
      fetch: fetcher as unknown as typeof fetch,
    });
    const hits = await docs.search('shipfox');
    expect(hits).toHaveLength(5);
    expect(hits[0]).toEqual({
      slug: 'understand',
      title: 'How Shipfox works',
      excerpt: 'How Shipfox works',
      uri: 'docs://shipfox/understand',
    });
    expect(fetcher).toHaveBeenCalledWith(
      new URL('https://docs.example.test/docs/api/search?query=shipfox'),
    );
    await docs.search('shipfox');
    expect(
      fetcher.mock.calls.filter(([target]) => target.pathname.endsWith('api/search')),
    ).toHaveLength(2);
  });
});
