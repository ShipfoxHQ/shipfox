const REDIRECT_ORIGIN = 'https://shipfox-redirect.invalid';

// Resolves and canonicalizes an internal path before returning it, so browser URL
// parsing cannot turn a seemingly safe path into an external or auth route.
export function sanitizeRedirectPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/')) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  let target: URL;
  try {
    target = new URL(decoded, REDIRECT_ORIGIN);
  } catch {
    return undefined;
  }
  if (target.origin !== REDIRECT_ORIGIN) return undefined;
  if (target.pathname === '/auth' || target.pathname.startsWith('/auth/')) return undefined;
  return `${target.pathname}${target.search}${target.hash}`;
}
