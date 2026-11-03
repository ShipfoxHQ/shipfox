import {isIP} from 'node:net';
import {bool, createConfig, port, str} from '@shipfox/config';

export type ApiTrustProxy = boolean | string;

const INTEGER_PATTERN = /^\d+$/;

export const config = createConfig({
  E2E_ENABLED: bool({
    desc: 'Enables the end-to-end test routes under /__e2e. Keep it false in production.',
    default: false,
  }),
  E2E_ADMIN_API_KEY: str({
    desc: 'Bearer token that protects the E2E admin routes. Set it when E2E_ENABLED is true.',
    default: undefined,
  }),
  API_PORT: port({
    desc: 'Port the API HTTP server listens on. When unset, the shared PORT setting controls the server port.',
    default: undefined,
  }),
  DOCS_BASE_URL: str({
    desc: 'Base URL of the Shipfox documentation site. Set an absolute HTTP or HTTPS URL to a docs site that serves `mcp.mdx/<slug>` pages, or set an empty string to disable MCP docs resources and search.',
    default: 'https://www.shipfox.io/docs',
  }),
  API_TRUST_PROXY: str({
    desc: 'Controls how the API trusts proxy headers for client IP detection. Use false when clients connect directly, true only when every caller is a trusted proxy, or the trusted proxy IP/CIDR such as 10.0.0.0/8. Hop counts are not accepted because they cannot verify the peer that sent the headers.',
    default: 'false',
  }),
});

function parseCidr(value: string): boolean {
  const [address, prefix, extra] = value.split('/');
  if (!address || !prefix || extra !== undefined || isIP(address) === 0) return false;

  const maxPrefix = isIP(address) === 4 ? 32 : 128;
  if (!INTEGER_PATTERN.test(prefix)) return false;

  const prefixNumber = Number(prefix);
  return prefixNumber >= 0 && prefixNumber <= maxPrefix;
}

export function parseApiTrustProxy(value: string): ApiTrustProxy {
  const trimmed = value.trim();
  if (trimmed === 'false') return false;
  if (trimmed === 'true') return true;

  // Fastify trusts no proxy for a hop count because it cannot verify the peer that set the
  // X-Forwarded-* headers, so a hop count would silently attribute every request to the proxy.
  if (INTEGER_PATTERN.test(trimmed)) {
    throw new Error(
      'API_TRUST_PROXY no longer accepts a hop count. Set the trusted proxy IP/CIDR instead, such as the load balancer subnet.',
    );
  }

  if (isIP(trimmed) !== 0 || parseCidr(trimmed)) return trimmed;

  throw new Error('API_TRUST_PROXY must be false, true, or a trusted proxy IP/CIDR');
}
