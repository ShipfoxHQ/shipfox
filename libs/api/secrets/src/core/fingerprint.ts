import crypto from 'node:crypto';

const FINGERPRINT_PREFIX = 'hmac-sha256:';
const FINGERPRINT_DOMAIN = 'shipfox:secrets:value-fingerprint:v1';

export function fingerprintSecretValue(value: string, key: Buffer): string {
  const digest = crypto
    .createHmac('sha256', key)
    .update(FINGERPRINT_DOMAIN)
    .update('\0')
    .update(value)
    .digest('base64url');
  return `${FINGERPRINT_PREFIX}${digest}`;
}
