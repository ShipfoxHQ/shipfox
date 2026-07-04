const TRAILING_SLASHES_PATTERN = /\/+$/;
const GOOGLE_DISCOVERY_VERSION_PATTERN = /\/v1beta$/;

export function appendCustomProviderPath(baseUrl: string, segment: string): URL {
  const url = new URL(normalizeCustomProviderBaseUrl(baseUrl));
  const path = url.pathname.replace(TRAILING_SLASHES_PATTERN, '');
  url.pathname = `${path}/${segment}`;
  return url;
}

export function normalizeCustomProviderBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    url.pathname = url.pathname.replace(TRAILING_SLASHES_PATTERN, '');
    return url.href;
  } catch {
    return baseUrl.replace(TRAILING_SLASHES_PATTERN, '');
  }
}

export function googleDiscoveryUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(GOOGLE_DISCOVERY_VERSION_PATTERN, '');
  return appendCustomProviderPath(normalizedBaseUrl, 'v1beta/models').toString();
}
