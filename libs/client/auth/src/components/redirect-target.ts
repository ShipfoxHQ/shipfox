const SEARCH_OR_HASH_RE = /[?#]/u;

// Returns the input string only if it is a same-origin internal path safe to
// navigate to after authentication. We decode before checking so percent-encoded
// variants like `/%61uth/login` cannot bypass the `/auth/*` rejection.
export function sanitizeRedirectPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  if (!decoded.startsWith('/')) return undefined;
  if (decoded.startsWith('//')) return undefined;
  // Strip search/hash before the /auth check so /auth?token=x and /auth#x
  // cannot bypass the prefix match.
  const pathOnly = decoded.split(SEARCH_OR_HASH_RE, 1)[0] ?? decoded;
  if (pathOnly === '/auth' || pathOnly.startsWith('/auth/')) return undefined;
  return value;
}
