import type {UIMessage} from 'ai';
import {z} from 'zod';
import type {CatalogSection} from '@/lib/page-catalog';

// Framework-free half of Ask AI, kept separate from `ask-ai-retrieval.ts` so the
// chat panel and the unit tests do not pull in the content source.

const LANGUAGE_CLASS_PREFIX = 'language-';
const DOCS_PATH_PREFIX = '/docs';
const ABSOLUTE_URL_PATTERN = /^https?:\/\//i;
const QUERY_OR_FRAGMENT_PATTERN = /[?#]/;

/** One whole documentation page, as the `read_page` tool returns it. */
export interface DocumentationPage {
  title: string;
  url: string;
  content: string;
}

/**
 * What the turn reported about itself. `finish_reason` separates an answer the
 * model chose to end from one the step budget cut short, and `provider` names
 * the OpenRouter endpoint that served it, which is the only way to attribute a
 * bad answer to a bad endpoint.
 */
export const askAiAnswerMetadataSchema = z.object({
  finish_reason: z.string().optional(),
  provider: z.string().optional(),
  steps: z.number().optional(),
});

export type AskAiAnswerMetadata = z.infer<typeof askAiAnswerMetadataSchema>;

/**
 * Wire contract between the Ask AI panel and its route handler. The `client`
 * data part carries the page the reader is on, so a question such as "how do I
 * set this up" can be answered against the page in front of them.
 */
export type AskAiMessage = UIMessage<
  AskAiAnswerMetadata,
  {client: {location: string}},
  {read_page: {input: {url: string}; output: DocumentationPage}}
>;

/**
 * The instructions carry the whole page catalog, so the model chooses a page
 * from a title and a description rather than guessing keywords against an index
 * that matches words rather than sentences. Paths stay relative so a citation
 * the model copies from here resolves as in-app navigation.
 */
export function renderPageCatalog(sections: readonly CatalogSection[]): string {
  const lines: string[] = [];
  for (const section of sections) {
    lines.push(`## ${section.label}`, '');
    for (const page of section.pages) {
      lines.push(`- [${page.title}](${page.url}): ${page.description}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/**
 * Reduces a page reference to the path the content source uses. The catalog
 * lists relative paths, but page bodies link to canonical absolute URLs under
 * `/docs`, so the model sees both forms and may hand back either.
 */
export function normalizePagePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return trimmed;

  let path = trimmed;
  if (ABSOLUTE_URL_PATTERN.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return trimmed;
    }
  }

  path = path.split(QUERY_OR_FRAGMENT_PATTERN)[0] ?? path;
  if (!path.startsWith('/')) path = `/${path}`;
  if (path === DOCS_PATH_PREFIX) return '/';
  if (path.startsWith(`${DOCS_PATH_PREFIX}/`)) path = path.slice(DOCS_PATH_PREFIX.length);
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

/** A link the model wrote in an answer, resolved against the deployed path prefix. */
export interface CitationLink {
  href: string | undefined;
  external: boolean;
}

/**
 * The catalog hands the model page paths, so a cited page needs the same path
 * prefix the router applies to in-app navigation.
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
