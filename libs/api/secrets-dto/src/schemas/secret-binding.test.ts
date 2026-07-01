import {describe, expect, it} from '@shipfox/vitest/vi';
import {materializedSecretBindingSchema, secretBindingSegmentSchema} from './secret-binding.js';

describe('secret binding schema', () => {
  it('accepts literal and secret segments', () => {
    const literal = secretBindingSegmentSchema.safeParse({kind: 'literal', value: 'abc'});
    const secret = secretBindingSegmentSchema.safeParse({
      kind: 'secret',
      store: 'local',
      key: 'API_KEY',
    });

    expect(literal.success).toBe(true);
    expect(secret.success).toBe(true);
  });

  it('rejects unknown segment kinds', () => {
    const result = secretBindingSegmentSchema.safeParse({kind: 'var', key: 'REGION'});

    expect(result.success).toBe(false);
  });

  it('rejects unknown secret stores', () => {
    const result = secretBindingSegmentSchema.safeParse({
      kind: 'secret',
      store: 'remote',
      key: 'API_KEY',
    });

    expect(result.success).toBe(false);
  });

  it('validates materialized bindings', () => {
    const result = materializedSecretBindingSchema.safeParse({
      target: 'OPENAI_API_KEY',
      segments: [
        {kind: 'literal', value: 'Bearer '},
        {kind: 'secret', store: 'local', key: 'API_KEY'},
      ],
    });

    expect(result.success).toBe(true);
  });
});
