import {sanitizeRedirectPath} from './redirect-target.js';

const INVITATION_ACCEPT_PATH = '/invitations/accept';

export interface RedirectContext {
  invitationToken?: string;
  returnTo?: string;
}

/**
 * Separates a safe post-authentication destination from an invitation token.
 * The token never remains in `returnTo`, so callers can keep it in their
 * short-lived invitation flow instead of forwarding it through generic redirects.
 */
export function parseRedirectContext(value: unknown): RedirectContext {
  const redirect = sanitizeRedirectPath(value);
  if (!redirect) return {};

  const decoded = decodeURIComponent(redirect);
  const [path, queryString = ''] = decoded.split('?', 2);
  if (path !== INVITATION_ACCEPT_PATH) return {returnTo: redirect};

  const params = new URLSearchParams(queryString);
  const invitationToken = params.get('token');
  return invitationToken ? {invitationToken} : {};
}
