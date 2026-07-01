import {stripUrlCredentials} from '@shipfox/redact';

export function fingerprintSecretValue(value: string): string | null {
  const stripped = stripUrlCredentials(value);
  if (stripped.length <= 4) return null;
  return stripped.slice(-4);
}
