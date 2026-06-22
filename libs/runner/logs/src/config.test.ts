describe('SHIPFOX_AGENT_SESSION_FLUSH_BYTES validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    '65535',
    '4194305',
  ])('fails startup when SHIPFOX_AGENT_SESSION_FLUSH_BYTES is %s', async (value) => {
    vi.stubEnv('SHIPFOX_AGENT_SESSION_FLUSH_BYTES', value);
    vi.resetModules();

    await expect(import('#config.js')).rejects.toThrow('SHIPFOX_AGENT_SESSION_FLUSH_BYTES');
  });

  it.each([
    '65536',
    '4194304',
  ])('accepts boundary value %s for SHIPFOX_AGENT_SESSION_FLUSH_BYTES', async (value) => {
    vi.stubEnv('SHIPFOX_AGENT_SESSION_FLUSH_BYTES', value);
    vi.resetModules();

    const {config} = await import('#config.js');

    expect(config.SHIPFOX_AGENT_SESSION_FLUSH_BYTES).toBe(Number(value));
  });
});
