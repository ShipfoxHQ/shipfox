import type {CaptureResult} from 'posthog-js';

const EMAIL_REGEX = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/i;
const URL_SCHEME_REGEX = /\b[a-z][a-z\d+.-]*:\/\//i;
const CREDENTIAL_ASSIGNMENT_REGEX =
  /\b[\w.-]*(?:api[_-]?key|authorization|password|secret|token)[\w.-]*\s*[:=]\s*\S+/i;
const TOKEN_REGEX = /[a-z\d_+/=-]{32,}/i;
const URL_SUFFIX_REGEX = /[?#]/;
const TRAILING_SLASH_REGEX = /\/+$/;
const URL_PROPERTY_NAMES = [
  '$current_url',
  '$referrer',
  '$initial_current_url',
  '$initial_referrer',
  '$session_entry_url',
] as const;

export interface CatalogQuery {
  query: string;
  queryLength: number;
  queryRedacted: boolean;
  dedupeKey: string;
}

export interface CatalogSearchState {
  capture: boolean;
  lastQuery: string | null;
}

export function buildDocsEventProperties<Properties extends object>(
  pathname: string,
  docsBasePath: string,
  properties: Properties,
) {
  const {pagePath, docsSection} = normalizeDocsLocation(pathname, docsBasePath);
  return {
    surface: 'docs' as const,
    page_path: pagePath,
    docs_section: docsSection,
    schema_version: 1 as const,
    ...properties,
  };
}

export function normalizeCatalogQuery(value: string): CatalogQuery {
  const normalized = value.trim().toLocaleLowerCase().replaceAll(/\s+/g, ' ');
  const queryRedacted = containsSensitiveQueryValue(normalized);

  return {
    query: queryRedacted ? '[redacted]' : normalized.slice(0, 100),
    queryLength: normalized.length,
    queryRedacted,
    dedupeKey: normalized,
  };
}

export function nextCatalogSearchState(
  lastQuery: string | null,
  currentQuery: string,
): CatalogSearchState {
  if (currentQuery.length === 0) return {capture: false, lastQuery: null};
  if (currentQuery === lastQuery) return {capture: false, lastQuery};
  return {capture: true, lastQuery: currentQuery};
}

export function normalizeDocsLocation(
  pathname: string,
  docsBasePath: string,
): {pagePath: string; docsSection: string} {
  const withoutBasePath =
    docsBasePath && (pathname === docsBasePath || pathname.startsWith(`${docsBasePath}/`))
      ? pathname.slice(docsBasePath.length)
      : pathname;
  const pagePath = normalizePathname(withoutBasePath);
  const docsSection = pagePath === '/' ? 'home' : (pagePath.split('/')[1] ?? 'home');

  return {pagePath, docsSection};
}

export function sanitizeTrackedUrl(value: string): string {
  try {
    const parsed = new URL(value, 'https://docs.invalid');
    const sanitized = `${parsed.origin}${parsed.pathname}`;
    return parsed.origin === 'https://docs.invalid' ? parsed.pathname : sanitized;
  } catch {
    return value.split(URL_SUFFIX_REGEX, 1)[0] ?? value;
  }
}

export function sanitizePosthogCapture(result: CaptureResult | null): CaptureResult | null {
  if (!result) return null;

  const properties = {...result.properties};
  for (const name of URL_PROPERTY_NAMES) {
    const value = properties[name];
    if (typeof value === 'string') properties[name] = sanitizeTrackedUrl(value);
  }

  return {...result, properties};
}

export function destinationFromHref(
  href: string,
  currentUrl: string,
): {origin: string; pathname: string} | null {
  try {
    const destination = new URL(href, currentUrl);
    if (destination.protocol !== 'http:' && destination.protocol !== 'https:') return null;
    return {origin: destination.origin, pathname: normalizePathname(destination.pathname)};
  } catch {
    return null;
  }
}

function containsSensitiveQueryValue(value: string): boolean {
  return (
    EMAIL_REGEX.test(value) ||
    URL_SCHEME_REGEX.test(value) ||
    CREDENTIAL_ASSIGNMENT_REGEX.test(value) ||
    TOKEN_REGEX.test(value)
  );
}

function normalizePathname(pathname: string): string {
  const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (withLeadingSlash === '/') return withLeadingSlash;
  return withLeadingSlash.replace(TRAILING_SLASH_REGEX, '');
}
