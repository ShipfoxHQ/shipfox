import {
  mintRegistrationTokensBatchBodySchema,
  mintRegistrationTokensRunnerInstanceSchema,
} from './mint-registration-tokens.js';

describe('mintRegistrationTokensRunnerInstanceSchema', () => {
  it('accepts provisioned runner ids up to the lifecycle report limit', () => {
    const result = mintRegistrationTokensRunnerInstanceSchema.safeParse({
      provider_runner_id: 'a'.repeat(255),
    });

    expect(result.success).toBe(true);
  });
});

describe('mintRegistrationTokensBatchBodySchema', () => {
  it('rejects duplicate provisioned runner ids', () => {
    const result = mintRegistrationTokensBatchBodySchema.safeParse({
      reservation_id: crypto.randomUUID(),
      runner_instances: [
        {provider_runner_id: 'provisioned-runner-1'},
        {provider_runner_id: 'provisioned-runner-1'},
      ],
    });

    expect(result.success).toBe(false);
  });
});
