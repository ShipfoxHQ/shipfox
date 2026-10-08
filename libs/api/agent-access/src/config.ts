import {bool, createConfig, str} from '@shipfox/config';

const TRAILING_SLASH = /\/$/u;

export const config = createConfig({
  DOCS_BASE_URL: str({
    desc: 'Base URL of the Shipfox documentation site. Set an absolute HTTP or HTTPS URL to a docs site that serves `mcp.mdx/<slug>` pages, or set an empty string to disable MCP docs resources and search.',
    default: 'https://www.shipfox.io/docs',
  }),
  AGENT_ACCESS_ADMIN_MCP_ENABLED: bool({
    desc: 'Whether the API serves the admin MCP endpoint at POST /mcp/admin. Defaults to false. The endpoint lets administrators find users and open impersonation windows, and it shares the OAuth resource of /mcp. Every call still requires an administrator role. Enable it only when AUTH_IMPERSONATION_ENABLED is true.',
    default: false,
  }),
});

export function docsBaseUrl(value: string): URL | undefined {
  if (value === '') return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('DOCS_BASE_URL must be an absolute HTTP or HTTPS URL or empty');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    value.includes('?') ||
    value.includes('#') ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      'DOCS_BASE_URL must be an absolute HTTP or HTTPS URL without credentials, query, or fragment',
    );
  }
  return new URL(`${parsed.href.replace(TRAILING_SLASH, '')}/`);
}
