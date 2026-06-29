import {
  createProvisionerTokenBodySchema,
  MAX_PROVISIONER_TOKEN_TTL_SECONDS,
  provisionerIdentityResponseSchema,
} from './provisioner-token.js';

describe('provisioner token schemas', () => {
  it('accepts a valid create body', () => {
    const result = createProvisionerTokenBodySchema.parse({
      name: 'autoscaler',
      ttl_seconds: MAX_PROVISIONER_TOKEN_TTL_SECONDS,
    });

    expect(result).toEqual({
      name: 'autoscaler',
      ttl_seconds: MAX_PROVISIONER_TOKEN_TTL_SECONDS,
    });
  });

  it('rejects token TTLs above one year', () => {
    const result = createProvisionerTokenBodySchema.safeParse({
      ttl_seconds: MAX_PROVISIONER_TOKEN_TTL_SECONDS + 1,
    });

    expect(result.success).toBe(false);
  });

  it('parses provisioner identity responses', () => {
    const identity = {
      id: crypto.randomUUID(),
      workspace_id: crypto.randomUUID(),
    };

    const result = provisionerIdentityResponseSchema.parse(identity);

    expect(result).toEqual(identity);
  });
});
