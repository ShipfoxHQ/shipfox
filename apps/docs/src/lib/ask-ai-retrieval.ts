import type {InferPageType} from 'fumadocs-core/source';
import {type DocumentationPageExcerpt, rankMatchedPageUrls, truncatePage} from '@/lib/ask-ai-core';
import {getLLMText} from '@/lib/get-llm-text';
import {searchServer} from '@/lib/search-server';
import {source} from '@/lib/source';

const SEARCH_RESULT_LIMIT = 20;

const renderedPages = new Map<string, Promise<string>>();

export async function searchDocumentation(query: string): Promise<DocumentationPageExcerpt[]> {
  const results = await searchServer.search(query, {limit: SEARCH_RESULT_LIMIT});
  const pagesByUrl = new Map(source.getPages().map((page) => [page.url, page]));
  const matched = rankMatchedPageUrls(results).flatMap((pageUrl) => pagesByUrl.get(pageUrl) ?? []);

  return await Promise.all(
    matched.map(async (page) => ({
      title: page.data.title,
      url: page.url,
      content: await renderPage(page),
    })),
  );
}

function renderPage(page: InferPageType<typeof source>): Promise<string> {
  const cached = renderedPages.get(page.url);
  if (cached) return cached;

  // Page Markdown is fixed for the lifetime of the server and the same pages
  // match many questions, so each page is rendered once.
  const rendered = getLLMText(page).then(truncatePage);
  renderedPages.set(page.url, rendered);
  return rendered;
}
