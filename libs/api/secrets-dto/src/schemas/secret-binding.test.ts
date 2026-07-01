import {describe, expect, it} from '@shipfox/vitest/vi';
import {secretBindingSegmentSchema} from './secret-binding.js';

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
});
