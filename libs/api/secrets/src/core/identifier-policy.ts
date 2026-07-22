import {SENSITIVE_NAME_PATTERNS, SYSTEM_NAMESPACE_PREFIX} from '@shipfox/api-secrets-dto';

export function isSystemNamespace(namespace: string): boolean {
  return namespace.startsWith(SYSTEM_NAMESPACE_PREFIX);
}

export function isSensitiveSecretName(key: string): boolean {
  return SENSITIVE_NAME_PATTERNS.some((pattern) => key.includes(pattern));
}

export function isShortSecretValue(value: string, threshold: number): boolean {
  return value.length > 0 && value.length < threshold;
}
