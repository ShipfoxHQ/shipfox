import {docsBaseUrl} from '#config.js';

export const DOCS_INDEX_URI = 'docs://shipfox/index';
export const DOCS_TEMPLATE_URI = 'docs://shipfox/{slug}';
const DOCS_HOME_SLUG = 'home';
const INDEX_TTL_MS = 15 * 60_000;
const PAGE_TTL_MS = 60 * 60_000;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/u;
const LEADING_SLASH = /^\//u;
const TRAILING_SLASH = /\/$/u;
const HTML_TAG = /<[^>]*>/gu;
const INDEX_ENTRY = /^- \[([^\]]+)\]\(([^)]+)\):/u;

interface CachedText {
  text: string;
  etag: string | undefined;
  fetchedAt: number;
}

export interface DocsSearchHit {
  slug: string;
  title: string;
  excerpt: string;
  uri: string;
}

export interface DocsReadResult {
  text: string;
  cached: boolean;
  slug: string;
}

export class DocsUnavailableError extends Error {}

export interface DocsCache {
  readonly enabled: boolean;
  start(): void;
  isIndexCached(): boolean;
  readIndex(): Promise<DocsReadResult>;
  hasSlug(slug: string): Promise<boolean>;
  readPage(slug: string): Promise<DocsReadResult>;
  isPageCached(slug: string): boolean;
  search(query: string): Promise<DocsSearchHit[]>;
}

export function createDocsCache(options: {
  baseUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
  setInterval?: typeof setInterval;
}): DocsCache {
  const parsedBaseUrl = docsBaseUrl(options.baseUrl);
  if (parsedBaseUrl === undefined) {
    return {
      enabled: false,
      start: () => undefined,
      isIndexCached: () => false,
      readIndex: () => Promise.reject(new DocsUnavailableError('Documentation is disabled')),
      hasSlug: () => Promise.resolve(false),
      readPage: () => Promise.reject(new DocsUnavailableError('Documentation is disabled')),
      isPageCached: () => false,
      search: () => Promise.reject(new DocsUnavailableError('Documentation is disabled')),
    };
  }
  const baseUrl = parsedBaseUrl;
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const schedule = options.setInterval ?? setInterval;
  const pages = new Map<string, CachedText>();
  let index: CachedText | undefined;
  let titles = new Map<string, string>();
  let pendingIndex: Promise<void> | undefined;
  const pendingPages = new Map<string, Promise<void>>();

  function url(path: string): URL {
    return new URL(path, baseUrl);
  }

  function refreshIndex(): Promise<void> {
    if (pendingIndex) return pendingIndex;
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keep ETag and warm-cache recovery in one refresh operation.
    pendingIndex = (async () => {
      try {
        const response = await fetcher(url('llms.txt'), {
          headers: index?.etag ? {'If-None-Match': index.etag} : {},
        });
        if (response.status === 304 && index) {
          index = {...index, fetchedAt: now()};
          return;
        }
        if (!response.ok) throw new Error(`Documentation index returned ${response.status}`);
        const text = await response.text();
        const parsed = parseIndex(text, baseUrl);
        if (parsed.size === 0) throw new Error('Documentation index contains no pages');
        index = {text, fetchedAt: now(), etag: response.headers.get('etag') ?? undefined};
        titles = parsed;
        for (const slug of pages.keys()) if (!titles.has(slug)) pages.delete(slug);
      } catch (error) {
        if (!index)
          throw new DocsUnavailableError('Documentation index is unavailable', {cause: error});
      }
    })().finally(() => {
      pendingIndex = undefined;
    });
    return pendingIndex;
  }

  async function ensureIndex(): Promise<CachedText> {
    if (!index) await refreshIndex();
    if (!index) throw new DocsUnavailableError('Documentation index is unavailable');
    return index;
  }

  function refreshPage(slug: string): Promise<void> {
    const pending = pendingPages.get(slug);
    if (pending) return pending;
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keep ETag and warm-cache recovery in one refresh operation.
    const operation = (async () => {
      const previous = pages.get(slug);
      try {
        const response = await fetcher(
          url(slug === DOCS_HOME_SLUG ? 'index.md' : `llms.mdx/${slug}`),
          {
            headers: previous?.etag ? {'If-None-Match': previous.etag} : {},
          },
        );
        if (response.status === 304 && previous) {
          pages.set(slug, {...previous, fetchedAt: now()});
          return;
        }
        if (!response.ok) throw new Error(`Documentation page returned ${response.status}`);
        pages.set(slug, {
          text: await response.text(),
          etag: response.headers.get('etag') ?? undefined,
          fetchedAt: now(),
        });
      } catch (error) {
        if (!previous)
          throw new DocsUnavailableError('Documentation page is unavailable', {cause: error});
      }
    })().finally(() => {
      pendingPages.delete(slug);
    });
    pendingPages.set(slug, operation);
    return operation;
  }

  return {
    enabled: true,
    start: () => {
      void refreshIndex().catch(() => undefined);
      const timer = schedule(() => {
        void refreshIndex().catch(() => undefined);
      }, INDEX_TTL_MS);
      timer.unref?.();
    },
    isIndexCached: () => index !== undefined,
    readIndex: async () => {
      const cached = index !== undefined;
      return {text: (await ensureIndex()).text, cached, slug: 'index'};
    },
    hasSlug: async (slug) => {
      await ensureIndex();
      return titles.has(slug);
    },
    isPageCached: (slug) => {
      const page = pages.get(slug);
      return page !== undefined && now() - page.fetchedAt < PAGE_TTL_MS;
    },
    readPage: async (slug) => {
      await ensureIndex();
      if (!titles.has(slug)) throw new Error('Unknown documentation slug');
      const previous = pages.get(slug);
      const cached = previous !== undefined && now() - previous.fetchedAt < PAGE_TTL_MS;
      if (!cached) await refreshPage(slug);
      const page = pages.get(slug);
      if (!page) throw new DocsUnavailableError('Documentation page is unavailable');
      return {
        text: page.text,
        cached: cached || (previous !== undefined && page === previous),
        slug,
      };
    },
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: search response validation and result mapping share the bounded loop.
    search: async (query) => {
      await ensureIndex();
      let response: Response;
      try {
        const target = url('api/search');
        target.searchParams.set('query', query);
        response = await fetcher(target);
        if (!response.ok) throw new Error(`Documentation search returned ${response.status}`);
      } catch (error) {
        throw new DocsUnavailableError('Documentation search is unavailable', {cause: error});
      }
      let raw: unknown;
      try {
        raw = await response.json();
      } catch (error) {
        throw new DocsUnavailableError('Documentation search returned invalid data', {
          cause: error,
        });
      }
      if (!Array.isArray(raw))
        throw new DocsUnavailableError('Documentation search returned invalid data');
      const found = new Set<string>();
      const hits: DocsSearchHit[] = [];
      for (const value of raw) {
        if (typeof value !== 'object' || value === null) continue;
        const record = value as Record<string, unknown>;
        if (typeof record.url !== 'string') continue;
        const path = record.url.split('#')[0];
        const slug = path === '/' ? DOCS_HOME_SLUG : path?.replace(LEADING_SLASH, '');
        if (!slug || !titles.has(slug) || found.has(slug)) continue;
        found.add(slug);
        const title = titles.get(slug) ?? slug;
        const excerpt =
          typeof record.content === 'string'
            ? record.content.replace(HTML_TAG, '').slice(0, 500)
            : '';
        hits.push({slug, title, excerpt, uri: `docs://shipfox/${slug}`});
        if (hits.length === 5) break;
      }
      return hits;
    },
  };
}

export function isValidDocsSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && slug !== 'index' && slug !== 'llms-full.txt';
}

function parseIndex(text: string, baseUrl: URL): Map<string, string> {
  const titles = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = INDEX_ENTRY.exec(line);
    if (!match) continue;
    let page: URL;
    try {
      page = new URL(match[2] ?? '');
    } catch {
      continue;
    }
    const slug = pageSlug(page, baseUrl);
    if (slug && isValidDocsSlug(slug)) {
      titles.set(slug, match[1] ?? slug);
    }
  }
  return titles;
}

function pageSlug(page: URL, baseUrl: URL): string | undefined {
  const homePath = baseUrl.pathname.replace(TRAILING_SLASH, '');
  if (page.pathname === homePath || page.pathname === baseUrl.pathname) return DOCS_HOME_SLUG;
  if (!page.pathname.startsWith(baseUrl.pathname)) return undefined;
  return page.pathname.slice(baseUrl.pathname.length).replace(TRAILING_SLASH, '');
}
