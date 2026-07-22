import {describe, expect, it} from '@shipfox/vitest/vi';
import {isSensitiveSecretName, isShortSecretValue, isSystemNamespace} from './identifier-policy.js';

describe('isSystemNamespace', () => {
  it('classifies system and user namespaces', () => {
    expect(isSystemNamespace('system/agent/x')).toBe(true);
    expect(isSystemNamespace('')).toBe(false);
    expect(isSystemNamespace('REGION')).toBe(false);
  });
});

describe('isSensitiveSecretName', () => {
  it('classifies sensitive names', () => {
    expect(isSensitiveSecretName('API_TOKEN')).toBe(true);
    expect(isSensitiveSecretName('PASSWORD')).toBe(true);
    expect(isSensitiveSecretName('REGION')).toBe(false);
  });
});

describe('isShortSecretValue', () => {
  it('classifies short secret values', () => {
    expect(isShortSecretValue('short', 12)).toBe(true);
    expect(isShortSecretValue('long-enough-value', 12)).toBe(false);
  });
});
