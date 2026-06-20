import {config} from '#config.js';

const TRAILING_SLASHES_RE = /\/+$/;

export function giteaConnectionExternalUrl(externalAccountId: string): string {
  const base = config.GITEA_BASE_URL.replace(TRAILING_SLASHES_RE, '');
  return `${base}/${encodeURIComponent(externalAccountId)}`;
}
