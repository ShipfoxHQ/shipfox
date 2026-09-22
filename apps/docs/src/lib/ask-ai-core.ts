import type {UIMessage} from 'ai';
import type {SortedResult} from 'fumadocs-core/search';

// Framework-free half of Ask AI, kept separate from `ask-ai-retrieval.ts` so the
// chat panel and the unit tests do not pull in the content source.

const LANGUAGE_CLASS_PREFIX = 'language-';
const MAX_PAGES = 4;
const MAX_PAGE_CHARACTERS = 8_000;
const TRUNCATION_NOTICE = '\n\n[Page truncated. Open the page URL above for the rest.]';

/** One documentation page returned by the Ask AI retrieval tool. */
export interface DocumentationPageExcerpt {
  title: string;
  url: string;
  content: string;
}

/**
 * Wire contract between the Ask AI panel and its route handler. The `client`
 * data part carries the page the reader is on, so a question such as "how do I
 * set this up" can be answered against the page in front of them.
 */
export type AskAiMessage = UIMessage<
  never,
  {client: {location: string}},
  {search: {input: {query: string}; output: DocumentationPageExcerpt[]}}
>;

/**
 * The search index is section-level, so one page appears once per matching
 * heading. Ask AI answers from whole pages, so collapse the hits into a ranked
 * list of page URLs.
 */
export function rankMatchedPageUrls(
  results: readonly SortedResult[],
  limit: number = MAX_PAGES,
): string[] {
  const urls: string[] = [];
  for (const result of results) {
    const [pageUrl] = result.url.split('#');
    if (urls.includes(pageUrl)) continue;
    urls.push(pageUrl);
    if (urls.length === limit) break;
  }
  return urls;
}

/** Caps one page so a four-page answer cannot fill the model context. */
export function truncatePage(markdown: string): string {
  if (markdown.length <= MAX_PAGE_CHARACTERS) return markdown;
  return `${markdown.slice(0, MAX_PAGE_CHARACTERS)}${TRUNCATION_NOTICE}`;
}

/** A link the model wrote in an answer, resolved against the deployed path prefix. */
export interface CitationLink {
  href: string | undefined;
  external: boolean;
}

/**
 * The retrieval tool hands the model page paths, so a cited page needs the same
 * path prefix the router applies to in-app navigation.
 */
export function resolveCitationLink(href: string | undefined, prefix: string): CitationLink {
  if (href?.startsWith('/')) return {href: `${prefix}${href}`, external: false};
  return {href, external: true};
}

/** Reads the language of a fenced block from the `language-*` class Markdown emits. */
export function codeLanguage(className: string | undefined): string {
  const token = className?.split(' ').find((value) => value.startsWith(LANGUAGE_CLASS_PREFIX));
  return token?.slice(LANGUAGE_CLASS_PREFIX.length) ?? 'text';
}
