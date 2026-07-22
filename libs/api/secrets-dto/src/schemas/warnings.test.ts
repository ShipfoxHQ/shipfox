import {describe, expect, it} from '@shipfox/vitest/vi';
import {
  SENSITIVE_VARIABLE_NAME_WARNING,
  SHORT_SECRET_VALUE_WARNING,
  secretWriteWarningSchema,
} from './warnings.js';

describe('secret write warnings', () => {
  it('validates warning payloads', () => {
    expect(
      secretWriteWarningSchema.safeParse({code: SHORT_SECRET_VALUE_WARNING, key: 'TOKEN'}).success,
    ).toBe(true);
    expect(
      secretWriteWarningSchema.safeParse({
        code: SENSITIVE_VARIABLE_NAME_WARNING,
        key: 'API_TOKEN',
      }).success,
    ).toBe(true);
    expect(secretWriteWarningSchema.safeParse({code: 'unknown', key: 'TOKEN'}).success).toBe(false);
  });
});
