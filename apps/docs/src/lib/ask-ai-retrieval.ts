import type {InferPageType} from 'fumadocs-core/source';
import {type DocumentationPage, normalizePagePath, renderPageCatalog} from '@/lib/ask-ai-core';
import {getLLMText} from '@/lib/get-llm-text';
import {collectPageCatalog} from '@/lib/page-catalog';
import {source} from '@/lib/source';

type DocumentationPageSource = InferPageType<typeof source>;

let catalog: string | undefined;
let pagesByUrl: Map<string, DocumentationPageSource> | undefined;

const renderedPages = new Map<string, Promise<string>>();

/** The page catalog Ask AI puts in its instructions. Fixed per server instance. */
export function documentationCatalog(): string {
  catalog ??= renderPageCatalog(collectPageCatalog());
  return catalog;
}

/**
 * Returns a page whole. Ask AI answers from reference pages whose useful part is
 * a catalog entry far down the page, so a length cap here reliably hides the
 * exact fact the question was about.
 *
 * Throws when the path matches no page, which reaches the model as a tool error
 * it can recover from by picking another entry from the catalog.
 */
export async function readDocumentationPage(url: string): Promise<DocumentationPage> {
  const path = normalizePagePath(url);
  const page = pageIndex().get(path);
  if (!page) {
    throw new Error(`No documentation page at "${path}". Use a path listed in the page catalog.`);
  }

  return {title: page.data.title, url: page.url, content: await renderPage(page)};
}

function pageIndex(): Map<string, DocumentationPageSource> {
  pagesByUrl ??= new Map(source.getPages().map((page) => [page.url, page]));
  return pagesByUrl;
}

function renderPage(page: DocumentationPageSource): Promise<string> {
  const cached = renderedPages.get(page.url);
  if (cached) return cached;

  // Page Markdown is fixed for the lifetime of the server and the same pages
  // answer many questions, so each page is rendered once.
  const rendered = getLLMText(page);
  renderedPages.set(page.url, rendered);
  return rendered;
}
