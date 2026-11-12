import {config} from '#config.js';

const TRAILING_SLASHES_RE = /\/+$/;

export function azureDevOpsConnectionExternalUrl(organization: string): string {
  const base = config.AZURE_DEVOPS_BASE_URL.replace(TRAILING_SLASHES_RE, '');
  return `${base}/${encodeURIComponent(organization)}`;
}
