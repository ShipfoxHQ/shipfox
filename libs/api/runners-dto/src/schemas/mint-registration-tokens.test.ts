import {
  mintRegistrationTokensBatchBodySchema,
  mintRegistrationTokensProvisionedRunnerSchema,
} from './mint-registration-tokens.js';

describe('mintRegistrationTokensProvisionedRunnerSchema', () => {
  it('accepts provisioned runner ids up to the lifecycle report limit', () => {
    const result = mintRegistrationTokensProvisionedRunnerSchema.safeParse({
      provisioned_runner_id: 'a'.repeat(255),
    });

    expect(result.success).toBe(true);
  });
});

describe('mintRegistrationTokensBatchBodySchema', () => {
  it('rejects duplicate provisioned runner ids', () => {
    const result = mintRegistrationTokensBatchBodySchema.safeParse({
      reservation_id: crypto.randomUUID(),
      provisioned_runners: [
        {provisioned_runner_id: 'provisioned-runner-1'},
        {provisioned_runner_id: 'provisioned-runner-1'},
      ],
    });

    expect(result.success).toBe(false);
  });
});
