afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('managed runner startup', () => {
  it('consumes the bootstrap token without retaining it in configuration or the environment', async () => {
    vi.stubEnv('SHIPFOX_RUNNER_REGISTRATION_TOKEN', '');
    vi.stubEnv('SHIPFOX_RUNNER_BOOTSTRAP_TOKEN', 'sf_rbt_bootstrap-token');
    vi.stubEnv('SHIPFOX_RUNNER_PROVIDER_KIND', 'ec2');
    vi.resetModules();

    const {config, consumeManagedRunnerBootstrapToken, runnerStartupMode} = await import(
      '#config.js'
    );

    expect(runnerStartupMode()).toBe('managed');
    expect(process.env.SHIPFOX_RUNNER_BOOTSTRAP_TOKEN).toBeUndefined();
    expect(config.SHIPFOX_RUNNER_BOOTSTRAP_TOKEN).toBe('');
    expect(consumeManagedRunnerBootstrapToken()).toBe('sf_rbt_bootstrap-token');
    expect(() => consumeManagedRunnerBootstrapToken()).toThrow(
      'SHIPFOX_RUNNER_BOOTSTRAP_TOKEN is required for managed startup.',
    );
  });
});
