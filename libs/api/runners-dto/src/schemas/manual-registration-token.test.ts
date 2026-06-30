import {
  createManualRegistrationTokenBodySchema,
  MAX_MANUAL_REGISTRATION_TOKEN_TTL_SECONDS,
} from './manual-registration-token.js';

describe('manual registration token schemas', () => {
  it('accepts a valid create body', () => {
    const result = createManualRegistrationTokenBodySchema.parse({
      name: 'builder',
      ttl_seconds: MAX_MANUAL_REGISTRATION_TOKEN_TTL_SECONDS,
    });

    expect(result).toEqual({
      name: 'builder',
      ttl_seconds: MAX_MANUAL_REGISTRATION_TOKEN_TTL_SECONDS,
    });
  });

  it('accepts omitted TTL for never-expiring tokens', () => {
    const result = createManualRegistrationTokenBodySchema.parse({
      name: 'builder',
    });

    expect(result).toEqual({
      name: 'builder',
    });
  });

  it('rejects token TTLs above one year', () => {
    const result = createManualRegistrationTokenBodySchema.safeParse({
      ttl_seconds: MAX_MANUAL_REGISTRATION_TOKEN_TTL_SECONDS + 1,
    });

    expect(result.success).toBe(false);
  });
});
