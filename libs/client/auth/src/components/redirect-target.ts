const REDIRECT_ORIGIN = 'https://shipfox-redirect.invalid';
const LOGIN_PATH = '/auth/login';
const INVITATION_ACCEPT_PATH = '/invitations/accept';
const DEFAULT_LOGOUT_REDIRECT = LOGIN_PATH;
const TRAILING_SLASHES = /\/+$/;

function resolveRedirectPath(value: unknown): URL | undefined {
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
  return target;
}

function formatRedirectPath(target: URL): string {
  return `${target.pathname}${target.search}${target.hash}`;
}

function isAuthPath(pathname: string): boolean {
  return pathname === '/auth' || pathname.startsWith('/auth/');
}

// Resolves and canonicalizes an internal path before returning it, so browser URL
// parsing cannot turn a seemingly safe path into an external or auth route.
export function sanitizeRedirectPath(value: unknown): string | undefined {
  const target = resolveRedirectPath(value);
  if (!target || isAuthPath(target.pathname)) return undefined;
  return formatRedirectPath(target);
}

function containsInvitationToken(target: URL): boolean {
  const normalizedPathname = target.pathname.replace(TRAILING_SLASHES, '') || '/';
  return normalizedPathname === INVITATION_ACCEPT_PATH && target.searchParams.has('token');
}

/**
 * Returns the destination used by the shared logout route.
 *
 * Login is the only auth destination allowed, and invitation tokens never
 * survive this boundary. Invalid values fail closed to login.
 */
export function sanitizeLogoutRedirectPath(value: unknown): string {
  const target = resolveRedirectPath(value);
  if (!target) return DEFAULT_LOGOUT_REDIRECT;
  if (isAuthPath(target.pathname) || containsInvitationToken(target)) {
    return DEFAULT_LOGOUT_REDIRECT;
  }
  return formatRedirectPath(target);
}
