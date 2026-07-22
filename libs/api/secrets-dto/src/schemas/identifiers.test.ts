import {describe, expect, it} from '@shipfox/vitest/vi';
import {namespaceSchema, secretKeySchema} from './identifiers.js';

describe('secret identifiers', () => {
  it.each(['A', '_A', 'A_B1'])('accepts key %s', (key) => {
    const result = secretKeySchema.safeParse(key);

    expect(result.success).toBe(true);
  });

  it.each(['', '1A', 'a', 'A-B'])('rejects key %s', (key) => {
    const result = secretKeySchema.safeParse(key);

    expect(result.success).toBe(false);
  });

  it.each(['', 'prod', 'system/agent/openai', 'a/b_c'])('accepts namespace %s', (namespace) => {
    const result = namespaceSchema.safeParse(namespace);

    expect(result.success).toBe(true);
  });

  it.each([
    'Prod',
    '/prod',
    'prod/',
    'prod//',
    'prod space',
  ])('rejects namespace %s', (namespace) => {
    const result = namespaceSchema.safeParse(namespace);

    expect(result.success).toBe(false);
  });
});
