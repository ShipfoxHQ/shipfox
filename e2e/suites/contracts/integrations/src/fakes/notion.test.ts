import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {CONTRACT_FAKE_ADAPTERS} from './index.js';
import {notionContractFake} from './notion.js';
import type {ContractFakeContext} from './shared.js';

const missingTitlePattern = /fixture "page" has no "title"/u;

describe('notionContractFake', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  const context = (): ContractFakeContext => ({uniqueId: 'unique', cleanups});

  async function getJson({endpoint, path}: {endpoint: string | undefined; path: string}) {
    return (await (await fetch(new URL(path, endpoint))).json()) as Record<string, unknown>;
  }

  it('seeds Notion with the page fixtures, their title, content, and comments', async () => {
    const fake = await notionContractFake(context());

    await fake.seed({page: {id: 'page-1', title: 'Fixture page', comment_count: 32}});

    const endpoint = fake.env.NOTION_API_BASE_URL;
    const page = await getJson({endpoint, path: '/v1/pages/page-1'});
    const content = await getJson({endpoint, path: '/v1/pages/page-1/markdown'});
    const comments = (await getJson({endpoint, path: '/v1/comments?block_id=page-1'})) as {
      results: unknown[];
      has_more: boolean;
    };
    expect(fake.access).toEqual({accessToken: 'notion-access-token-unique'});
    expect(page).toMatchObject({
      id: 'page-1',
      properties: {title: {title: [{plain_text: 'Fixture page'}]}},
    });
    expect(content).toMatchObject({markdown: '# Fixture page\n', truncated: false});
    expect(comments.results).toHaveLength(32);
    expect(comments.has_more).toBe(false);
  });

  it('seeds Notion with a data source of the rows the fixture holds', async () => {
    const fake = await notionContractFake(context());

    await fake.seed({data_source: {id: 'source-1', name: 'Fixture data source', row_count: 105}});

    const endpoint = fake.env.NOTION_API_BASE_URL;
    const query = async (body: unknown) =>
      (await (
        await fetch(new URL('/v1/data_sources/source-1/query', endpoint), {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify(body),
        })
      ).json()) as {results: unknown[]; has_more: boolean; next_cursor: string | null};
    const first = await query({page_size: 100});
    const last = await query({start_cursor: first.next_cursor});
    expect(first.results).toHaveLength(100);
    expect(first.has_more).toBe(true);
    expect(last.results).toHaveLength(5);
    expect(last).toMatchObject({has_more: false, next_cursor: null});
  });

  it('rejects a page fixture without a title', async () => {
    const fake = await notionContractFake(context());

    await expect(fake.seed({page: {id: 'page-1'}})).rejects.toThrow(missingTitlePattern);
  });

  it('is the adapter of the notion provider', () => {
    expect(CONTRACT_FAKE_ADAPTERS.notion).toBe(notionContractFake);
  });
});
