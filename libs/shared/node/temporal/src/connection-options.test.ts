import {loadTemporalConfig} from './config.js';
import {getTemporalConnectionOptions, temporalConnectionError} from './connection-options.js';

function loadConfig(update: Partial<NodeJS.ProcessEnv> = {}) {
  return loadTemporalConfig({
    TEMPORAL_ADDRESS: 'localhost:7233',
    TEMPORAL_NAMESPACE: 'default',
    TEMPORAL_TASK_QUEUE: 'shipfox',
    TEMPORAL_API_KEY: undefined,
    ...update,
  });
}

describe('getTemporalConnectionOptions', () => {
  it('keeps local Temporal connections unauthenticated', () => {
    const config = loadConfig();

    const result = getTemporalConnectionOptions(config);

    expect(result).toEqual({address: 'localhost:7233'});
  });

  it('enables TLS and API key authentication when a key is configured', () => {
    const config = loadConfig({
      TEMPORAL_ADDRESS: 'shipfox.account.tmprl.cloud:7233',
      TEMPORAL_NAMESPACE: 'shipfox.account',
      TEMPORAL_API_KEY: 'cloud-secret',
    });

    const result = getTemporalConnectionOptions(config);

    expect(result).toEqual({
      address: 'shipfox.account.tmprl.cloud:7233',
      apiKey: 'cloud-secret',
      tls: true,
    });
  });
});

describe('loadTemporalConfig', () => {
  it('rejects a Temporal Cloud address without an API key', () => {
    const load = () =>
      loadConfig({
        TEMPORAL_ADDRESS: 'shipfox.account.tmprl.cloud:7233',
        TEMPORAL_NAMESPACE: 'shipfox.account',
      });

    expect(load).toThrow(
      'TEMPORAL_API_KEY is required when TEMPORAL_ADDRESS points to Temporal Cloud',
    );
  });
});

describe('temporalConnectionError', () => {
  it('keeps API key material out of the actionable error message', () => {
    const cause = new Error('unauthenticated');
    const config = loadConfig({TEMPORAL_API_KEY: 'cloud-secret'});

    const result = temporalConnectionError(cause, config);

    expect(result.message).toBe(
      'Failed to connect to Temporal. Verify TEMPORAL_ADDRESS and TEMPORAL_API_KEY.',
    );
    expect(result.message).not.toContain('cloud-secret');
    expect(result.cause).toBe(cause);
  });
});
