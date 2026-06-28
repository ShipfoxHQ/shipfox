import {isIP} from 'node:net';
import {bool, createConfig, str} from '@shipfox/config';

export type ApiTrustProxy = false | true | number | string;

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
  API_TRUST_PROXY: str({
    desc: 'Controls how the API trusts proxy headers for client IP detection. Use false when clients connect directly, true only when every caller is a trusted proxy, a positive hop count such as 1, or a trusted proxy IP/CIDR such as 10.0.0.0/8.',
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

  if (INTEGER_PATTERN.test(trimmed)) {
    const hops = Number(trimmed);
    if (Number.isSafeInteger(hops) && hops > 0) return hops;
    throw new Error('API_TRUST_PROXY hop count must be a positive safe integer');
  }

  if (isIP(trimmed) !== 0 || parseCidr(trimmed)) return trimmed;

  throw new Error(
    'API_TRUST_PROXY must be false, true, a positive hop count, or a trusted proxy IP/CIDR',
  );
}
